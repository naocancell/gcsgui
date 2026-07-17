use proc_macro::TokenStream;
use quote::quote;
use syn::{Data, DeriveInput, Fields, LitInt, LitStr, parse_macro_input};

#[proc_macro_derive(FPPacketParser, attributes(frame, scale, bits, subframe, bitflags))]
pub fn derive_packet_parser(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let struct_name = &ast.ident;

    // 解析结构体级别的 #[frame(payload_size = N, id = M)]
    let mut expected_payload_size = None;
    let mut frame_id = None;
    for attr in &ast.attrs {
        if attr.path().is_ident("frame") {
            let _ = attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("payload_size") {
                    let value = meta.value()?;
                    let lit: LitInt = value.parse()?;
                    expected_payload_size = Some(lit.base10_parse::<usize>().unwrap());
                } else if meta.path.is_ident("id") {
                    let value = meta.value()?;
                    let lit: LitInt = value.parse()?;
                    frame_id = Some(lit.base10_parse::<u8>().unwrap());
                }
                Ok(())
            });
        }
    }

    let fields = if let Data::Struct(data_struct) = &ast.data {
        if let Fields::Named(named_fields) = &data_struct.fields {
            &named_fields.named
        } else {
            panic!("FPPacketParser 只能用于带命名字段的结构体");
        }
    } else {
        panic!("FPPacketParser 只能用于结构体");
    };

    let mut parse_quotes: Vec<proc_macro2::TokenStream> = Vec::new();
    let mut bit_cursor: usize = 0;
    // 编译期大小累加表达式，用于 const assert
    let mut compile_time_size_expr = quote! { 0usize };
    let mut compile_time_bit_acc: usize = 0;
    let mut has_subframe_without_size = false;

    for f in fields.iter() {
        let field_name = &f.ident;
        let field_type = &f.ty;

        let mut bits_count: Option<usize> = None;
        let mut scale_raw_type: Option<String> = None;
        let mut scale_factor: Option<String> = None;
        let mut scale_offset: Option<String> = None;
        let mut is_subframe = false;
        let mut subframe_size: Option<usize> = None;
        let mut bitflags_raw_type: Option<String> = None;

        for attr in &f.attrs {
            if attr.path().is_ident("bits") {
                // 解析 #[bits(3)] —— 单参数语法
                let lit: LitInt = attr.parse_args().unwrap();
                bits_count = Some(lit.base10_parse::<usize>().unwrap());
            } else if attr.path().is_ident("scale") {
                let _ = attr.parse_nested_meta(|meta| {
                    if meta.path.is_ident("raw_type") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        scale_raw_type = Some(lit.value());
                    } else if meta.path.is_ident("factor") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        scale_factor = Some(lit.value());
                    } else if meta.path.is_ident("offset") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        scale_offset = Some(lit.value());
                    }
                    Ok(())
                });
            } else if attr.path().is_ident("subframe") {
                is_subframe = true;
                let _ = attr.parse_nested_meta(|meta| {
                    if meta.path.is_ident("size") {
                        let value = meta.value()?;
                        let lit: LitInt = value.parse()?;
                        subframe_size = Some(lit.base10_parse::<usize>().unwrap());
                    }
                    Ok(())
                });
            } else if attr.path().is_ident("bitflags") {
                let _ = attr.parse_nested_meta(|meta| {
                    if meta.path.is_ident("raw_type") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        bitflags_raw_type = Some(lit.value());
                    }
                    Ok(())
                });
            }
        }

        if is_subframe {
            // ===== 子帧字段：读取 1 字节子帧 ID 后自动分发 =====
            if bit_cursor > 0 {
                let bytes_consumed = (bit_cursor + 7) / 8;
                parse_quotes.push(quote! { offset += #bytes_consumed; });
                bit_cursor = 0;
            }
            if compile_time_bit_acc > 0 {
                let bit_bytes = (compile_time_bit_acc + 7) / 8;
                compile_time_size_expr = quote! { #compile_time_size_expr + #bit_bytes };
                compile_time_bit_acc = 0;
            }

            if let Some(s) = subframe_size {
                // 子帧 ID(1字节) + 子帧本身的大小
                compile_time_size_expr = quote! { #compile_time_size_expr + 1usize + #s };
            } else {
                has_subframe_without_size = true;
            }

            parse_quotes.push(quote! {
                let sub_frame_id = *data.get(offset).ok_or_else(|| "读取子帧ID越界".to_string())?;
                offset += 1;
                let sub_slice = data.get(offset..).ok_or_else(|| "读取子帧内容越界".to_string())?;
                let #field_name = <#field_type>::from_bytes(sub_frame_id, sub_slice)?;
            });
        } else if let Some(n) = bits_count {
            // ===== 位域字段（支持最多32位跨字节安全拼接） =====
            let byte_index = bit_cursor / 8;
            let bit_within_byte = bit_cursor % 8;
            let needed_bytes = (bit_within_byte + n + 7) / 8;
            let mask = (1u32 << n) - 1;

            parse_quotes.push(quote! {
                let slice = data.get(offset + #byte_index .. offset + #byte_index + #needed_bytes)
                    .ok_or_else(|| format!("读取位域字段 {} 越界", stringify!(#field_name)))?;
                let mut buf = [0u8; 4];
                buf[..#needed_bytes].copy_from_slice(slice);
                let raw_u32 = u32::from_le_bytes(buf);
                let #field_name = ((raw_u32 >> #bit_within_byte) & #mask) as #field_type;
            });

            bit_cursor += n;
            compile_time_bit_acc += n;
        } else {
            // ===== 非位域字段：先刷新之前累积的位域组 =====
            if bit_cursor > 0 {
                let bytes_consumed = (bit_cursor + 7) / 8;
                parse_quotes.push(quote! { offset += #bytes_consumed; });
                bit_cursor = 0;
            }
            // 刷新位域到编译期累加
            if compile_time_bit_acc > 0 {
                let bit_bytes = (compile_time_bit_acc + 7) / 8;
                compile_time_size_expr = quote! { #compile_time_size_expr + #bit_bytes };
                compile_time_bit_acc = 0;
            }

            if let Some(raw_type_str) = bitflags_raw_type {
                let raw_type: proc_macro2::TokenStream = raw_type_str.parse().unwrap();
                parse_quotes.push(quote! {
                    let size = std::mem::size_of::<#raw_type>();
                    let slice = data.get(offset..offset + size)
                        .ok_or_else(|| format!("解析 {} 字段越界", stringify!(#field_name)))?;
                    let raw_val = <#raw_type>::from_le_bytes(slice.try_into().unwrap());
                    let #field_name = <#field_type>::from_raw(raw_val);
                    offset += size;
                });
                compile_time_size_expr =
                    quote! { #compile_time_size_expr + std::mem::size_of::<#raw_type>() };
            } else if let Some(raw_type_str) = scale_raw_type {
                // 带缩放的字段
                let factor: proc_macro2::TokenStream = scale_factor
                    .unwrap_or_else(|| "1.0".to_string())
                    .parse()
                    .unwrap();
                let offset_val: proc_macro2::TokenStream = scale_offset
                    .unwrap_or_else(|| "0.0".to_string())
                    .parse()
                    .unwrap();

                if raw_type_str == "u24" {
                    parse_quotes.push(quote! {
                        let size = 3usize;
                        let slice = data.get(offset..offset + size)
                            .ok_or_else(|| format!("解析 {} 字段越界", stringify!(#field_name)))?;
                        let raw_val = u32::from_le_bytes([slice[0], slice[1], slice[2], 0]);
                        let #field_name = ((raw_val as f64) * (#factor as f64) + (#offset_val as f64)) as #field_type;
                        offset += size;
                    });
                    compile_time_size_expr = quote! { #compile_time_size_expr + 3usize };
                } else {
                    let raw_type: proc_macro2::TokenStream = raw_type_str.parse().unwrap();
                    parse_quotes.push(quote! {
                        let size = std::mem::size_of::<#raw_type>();
                        let slice = data.get(offset..offset + size)
                            .ok_or_else(|| format!("解析 {} 字段越界", stringify!(#field_name)))?;
                        let raw_val = <#raw_type>::from_le_bytes(slice.try_into().unwrap());
                        let #field_name = ((raw_val as f64) * (#factor as f64) + (#offset_val as f64)) as #field_type;
                        offset += size;
                    });
                    compile_time_size_expr =
                        quote! { #compile_time_size_expr + std::mem::size_of::<#raw_type>() };
                }
            } else if let syn::Type::Array(_) = &f.ty {
                parse_quotes.push(quote! {
                    let size = std::mem::size_of::<#field_type>();
                    let slice = data.get(offset..offset + size)
                        .ok_or_else(|| format!("解析 {} 字段越界", stringify!(#field_name)))?;
                    let #field_name: #field_type = slice.try_into().unwrap();
                    offset += size;
                });
                compile_time_size_expr =
                    quote! { #compile_time_size_expr + std::mem::size_of::<#field_type>() };
            } else {
                // 普通字段
                parse_quotes.push(quote! {
                    let size = std::mem::size_of::<#field_type>();
                    let slice = data.get(offset..offset + size)
                        .ok_or_else(|| format!("解析 {} 字段越界", stringify!(#field_name)))?;
                    let #field_name = <#field_type>::from_le_bytes(slice.try_into().unwrap());
                    offset += size;
                });
                // 编译期累加普通字段的类型大小
                compile_time_size_expr =
                    quote! { #compile_time_size_expr + std::mem::size_of::<#field_type>() };
            }
        }
    }

    // 循环结束后，刷新最后一组残余的位域
    if bit_cursor > 0 {
        let bytes_consumed = (bit_cursor + 7) / 8;
        parse_quotes.push(quote! { offset += #bytes_consumed; });
    }
    if compile_time_bit_acc > 0 {
        let bit_bytes = (compile_time_bit_acc + 7) / 8;
        compile_time_size_expr = quote! { #compile_time_size_expr + #bit_bytes };
    }

    let field_names: Vec<_> = fields.iter().map(|f| &f.ident).collect();

    let expected_payload_size = expected_payload_size
        .expect("使用 FPPacketParser 必须在结构体上标注 #[frame(payload_size = N)] 以确保安全");

    if has_subframe_without_size {
        panic!("带有 #[subframe] 的字段必须明确指定大小，例如: #[subframe(size = 6)]");
    }

    // 编译期 const assert 校验 payload_size
    let compile_time_check = quote! {
        const _: () = assert!(
            (#compile_time_size_expr) == #expected_payload_size,
            "结构体字段的底层字节数总和与声明的 payload_size 不匹配"
        );
    };

    let frame_id_const = if let Some(id) = frame_id {
        quote! {
            pub const FRAME_ID: u8 = #id;
        }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #compile_time_check

        impl #struct_name {
            #frame_id_const

            pub fn from_bytes(data: &[u8]) -> Result<Self, String> {
                let mut offset = 0;
                #(#parse_quotes)*
                Ok(Self {
                    #(#field_names),*
                })
            }
        }
    };

    TokenStream::from(expanded)
}

/// 为子帧枚举自动生成 `from_bytes(id: u8, data: &[u8])` 分发方法
#[proc_macro_derive(FPSubFrame, attributes(id))]
pub fn derive_sub_frame(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let enum_name = &ast.ident;

    let variants = if let Data::Enum(data_enum) = &ast.data {
        &data_enum.variants
    } else {
        panic!("FPSubFrame 只能用于枚举");
    };

    let mut match_arms: Vec<proc_macro2::TokenStream> = Vec::new();

    for variant in variants {
        let variant_name = &variant.ident;

        // 解析 #[id(N)]
        let mut id_value: Option<u8> = None;
        for attr in &variant.attrs {
            if attr.path().is_ident("id") {
                let lit: LitInt = attr.parse_args().unwrap();
                id_value = Some(lit.base10_parse::<u8>().unwrap());
            }
        }
        let id = id_value.unwrap_or_else(|| panic!("子帧变体 {} 缺少 #[id(N)] 属性", variant_name));

        // 获取元组变体的内部类型
        let inner_type = if let Fields::Unnamed(fields) = &variant.fields {
            &fields
                .unnamed
                .first()
                .expect("子帧变体必须包含一个内部类型")
                .ty
        } else {
            panic!("子帧变体 {} 必须是元组形式，如 SF0(TypeName)", variant_name);
        };

        match_arms.push(quote! {
            #id => Ok(#enum_name::#variant_name(#inner_type::from_bytes(data)?)),
        });
    }

    let expanded = quote! {
        impl #enum_name {
            pub fn from_bytes(id: u8, data: &[u8]) -> Result<Self, String> {
                match id {
                    #(#match_arms)*
                    other => Err(format!("未知子帧编号: {}", other)),
                }
            }
        }
    };

    TokenStream::from(expanded)
}

/// 为结构体生成按位解析 `from_raw(val: T) -> Self` 方法
#[proc_macro_derive(FPBitFlags, attributes(skip, bits))]
pub fn derive_bit_flags(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let struct_name = &ast.ident;

    let fields = if let Data::Struct(data_struct) = &ast.data {
        if let Fields::Named(named_fields) = &data_struct.fields {
            &named_fields.named
        } else {
            panic!("FPBitFlags 只能用于带命名字段的结构体");
        }
    } else {
        panic!("FPBitFlags 只能用于结构体");
    };

    let mut field_assigns = Vec::new();
    let mut bit_cursor: usize = 0;

    for f in fields.iter() {
        let field_name = &f.ident;
        let field_type = &f.ty;

        let mut skip_count: usize = 0;
        let mut bits_count: Option<usize> = None;

        for attr in &f.attrs {
            if attr.path().is_ident("skip") {
                let lit: LitInt = attr.parse_args().unwrap();
                skip_count += lit.base10_parse::<usize>().unwrap();
            } else if attr.path().is_ident("bits") {
                let lit: LitInt = attr.parse_args().unwrap();
                bits_count = Some(lit.base10_parse::<usize>().unwrap());
            }
        }

        if skip_count > 0 {
            bit_cursor += skip_count;
        }

        if let Some(n) = bits_count {
            let mask = if n >= 64 { !0u64 } else { (1u64 << n) - 1 };
            field_assigns.push(quote! {
                #field_name: ((val >> #bit_cursor) & #mask) as #field_type
            });
            bit_cursor += n;
        } else {
            field_assigns.push(quote! {
                #field_name: ((val >> #bit_cursor) & 1) != 0
            });
            bit_cursor += 1;
        }
    }

    let expanded = quote! {
        impl #struct_name {
            pub fn from_raw<T: Into<u64>>(val: T) -> Self {
                let val: u64 = val.into();
                Self {
                    #(#field_assigns),*
                }
            }
        }
    };

    TokenStream::from(expanded)
}

/// 自动生成数据聚合结构体及 `merge` 分发方法
#[proc_macro_derive(FPAggregate, attributes(aggregate_struct, aggregate))]
pub fn derive_aggregate(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let enum_name = &ast.ident;

    let mut agg_struct_name = syn::Ident::new("FP981CAggregate", enum_name.span());
    let mut aggregate_rename_all: Option<LitStr> = None;
    for attr in &ast.attrs {
        if attr.path().is_ident("aggregate_struct") {
            let _ = attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("rename_all") {
                    aggregate_rename_all = Some(meta.value()?.parse()?);
                } else if let Some(ident) = meta.path.get_ident() {
                    agg_struct_name = ident.clone();
                }
                Ok(())
            });
        }
    }

    let aggregate_serde_attr =
        aggregate_rename_all.map(|value| quote! { #[serde(rename_all = #value)] });

    let variants = if let Data::Enum(data_enum) = &ast.data {
        &data_enum.variants
    } else {
        panic!("FPAggregate 只能用于枚举");
    };

    let mut struct_fields: Vec<proc_macro2::TokenStream> = Vec::new();
    struct_fields.push(quote! { pub uav_id: u8 });

    let mut merge_arms: Vec<proc_macro2::TokenStream> = Vec::new();

    for variant in variants {
        let variant_ident = &variant.ident;
        let field_name = syn::Ident::new(
            &variant_ident.to_string().to_lowercase(),
            variant_ident.span(),
        );

        let inner_ty = if let Fields::Unnamed(fields) = &variant.fields {
            &fields.unnamed.first().expect("变体必须包含一个内部类型").ty
        } else {
            panic!("变体必须是元组形式");
        };

        struct_fields.push(quote! { pub #field_name: Option<#inner_ty> });

        let mut sub_enum_ident: Option<syn::Ident> = None;
        let mut sub_field_ident: Option<syn::Ident> = None;
        let mut sub_items: Vec<(syn::Ident, syn::Ident, syn::Ident)> = Vec::new(); // (sub_variant, sub_ty, sub_field_name)

        for attr in &variant.attrs {
            if attr.path().is_ident("aggregate") {
                let _ = attr.parse_nested_meta(|meta| {
                    if meta.path.is_ident("sub_enum") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        sub_enum_ident = Some(syn::Ident::new(
                            &lit.value(),
                            proc_macro2::Span::call_site(),
                        ));
                    } else if meta.path.is_ident("sub_field") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        sub_field_ident = Some(syn::Ident::new(
                            &lit.value(),
                            proc_macro2::Span::call_site(),
                        ));
                    } else if meta.path.is_ident("subs") {
                        let _ = meta.parse_nested_meta(|sub_meta| {
                            let sub_variant = sub_meta.path.get_ident().unwrap().clone();
                            let mut sub_ty: Option<syn::Ident> = None;
                            let _ = sub_meta.parse_nested_meta(|inner_meta| {
                                sub_ty = Some(inner_meta.path.get_ident().unwrap().clone());
                                Ok(())
                            });
                            if let Some(ty) = sub_ty {
                                let sub_field_name = syn::Ident::new(
                                    &format!(
                                        "{}_{}",
                                        variant_ident.to_string().to_lowercase(),
                                        sub_variant.to_string().to_lowercase()
                                    ),
                                    sub_variant.span(),
                                );
                                sub_items.push((sub_variant, ty, sub_field_name));
                            }
                            Ok(())
                        });
                    }
                    Ok(())
                });
            }
        }

        if let (Some(s_enum), Some(s_field)) = (sub_enum_ident, sub_field_ident) {
            let mut sub_matches = Vec::new();
            for (sub_variant, sub_ty, sub_field_name) in &sub_items {
                struct_fields.push(quote! { pub #sub_field_name: Option<#sub_ty> });
                sub_matches.push(quote! {
                    #s_enum::#sub_variant(s) => self.#sub_field_name = Some(s.clone()),
                });
            }

            merge_arms.push(quote! {
                #enum_name::#variant_ident(val) => {
                    match &val.#s_field {
                        #(#sub_matches)*
                    }
                    self.#field_name = Some(val);
                }
            });
        } else {
            merge_arms.push(quote! {
                #enum_name::#variant_ident(val) => self.#field_name = Some(val),
            });
        }
    }

    let expanded = quote! {
        #[derive(Debug, Default, Clone, serde::Serialize)]
        #aggregate_serde_attr
        pub struct #agg_struct_name {
            #(#struct_fields),*
        }

        impl #agg_struct_name {
            pub fn merge(&mut self, parsed: #enum_name) {
                match parsed {
                    #(#merge_arms)*
                }
            }
        }
    };

    TokenStream::from(expanded)
}
