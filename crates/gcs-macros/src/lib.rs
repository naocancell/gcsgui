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
            if let Err(err) = attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("payload_size") {
                    let value = meta.value()?;
                    let lit: LitInt = value.parse()?;
                    expected_payload_size = Some(lit.base10_parse::<usize>()?);
                    Ok(())
                } else if meta.path.is_ident("id") {
                    let value = meta.value()?;
                    let lit: LitInt = value.parse()?;
                    frame_id = Some(lit.base10_parse::<u8>()?);
                    Ok(())
                } else {
                    Err(meta.error(format!(
                        "未知 #[frame(...)] 属性参数: {}",
                        meta.path.get_ident().map(|i| i.to_string()).unwrap_or_default()
                    )))
                }
            }) {
                return err.to_compile_error().into();
            }
        }
    }

    let fields = match &ast.data {
        Data::Struct(data_struct) => match &data_struct.fields {
            Fields::Named(named_fields) => &named_fields.named,
            _ => {
                return syn::Error::new_spanned(&ast, "FPPacketParser 只能用于带命名字段的结构体")
                    .to_compile_error()
                    .into();
            }
        },
        _ => {
            return syn::Error::new_spanned(&ast, "FPPacketParser 只能用于结构体")
                .to_compile_error()
                .into();
        }
    };

    let mut parse_quotes: Vec<proc_macro2::TokenStream> = Vec::new();
    let mut bit_cursor: usize = 0;
    // 编译期大小累加表达式，用于 const assert
    let mut compile_time_size_expr = quote! { 0usize };
    let mut compile_time_bit_acc: usize = 0;

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
                let lit: LitInt = match attr.parse_args() {
                    Ok(l) => l,
                    Err(err) => return err.to_compile_error().into(),
                };
                let count = match lit.base10_parse::<usize>() {
                    Ok(c) => c,
                    Err(err) => return err.to_compile_error().into(),
                };
                if count > 32 || count == 0 {
                    return syn::Error::new_spanned(attr, "#[bits(N)] 中的 N 必须在 1 到 32 之间")
                        .to_compile_error()
                        .into();
                }
                bits_count = Some(count);
            } else if attr.path().is_ident("scale") {
                if let Err(err) = attr.parse_nested_meta(|meta| {
                    if meta.path.is_ident("raw_type") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        scale_raw_type = Some(lit.value());
                        Ok(())
                    } else if meta.path.is_ident("factor") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        scale_factor = Some(lit.value());
                        Ok(())
                    } else if meta.path.is_ident("offset") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        scale_offset = Some(lit.value());
                        Ok(())
                    } else {
                        Err(meta.error(format!(
                            "未知 #[scale(...)] 属性参数: {}",
                            meta.path.get_ident().map(|i| i.to_string()).unwrap_or_default()
                        )))
                    }
                }) {
                    return err.to_compile_error().into();
                }
            } else if attr.path().is_ident("subframe") {
                is_subframe = true;
                if let Err(err) = attr.parse_nested_meta(|meta| {
                    if meta.path.is_ident("size") {
                        let value = meta.value()?;
                        let lit: LitInt = value.parse()?;
                        subframe_size = Some(lit.base10_parse::<usize>()?);
                        Ok(())
                    } else {
                        Err(meta.error(format!(
                            "未知 #[subframe(...)] 属性参数: {}",
                            meta.path.get_ident().map(|i| i.to_string()).unwrap_or_default()
                        )))
                    }
                }) {
                    return err.to_compile_error().into();
                }
            } else if attr.path().is_ident("bitflags") {
                if let Err(err) = attr.parse_nested_meta(|meta| {
                    if meta.path.is_ident("raw_type") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        bitflags_raw_type = Some(lit.value());
                        Ok(())
                    } else {
                        Err(meta.error(format!(
                            "未知 #[bitflags(...)] 属性参数: {}",
                            meta.path.get_ident().map(|i| i.to_string()).unwrap_or_default()
                        )))
                    }
                }) {
                    return err.to_compile_error().into();
                }
            }
        }

        let mut attr_count = 0;
        if bits_count.is_some() { attr_count += 1; }
        if scale_raw_type.is_some() { attr_count += 1; }
        if is_subframe { attr_count += 1; }
        if bitflags_raw_type.is_some() { attr_count += 1; }
        if attr_count > 1 {
            return syn::Error::new_spanned(
                f,
                "字段属性 #[bits]、#[scale]、#[subframe]、#[bitflags] 互斥，不能同时标注在同一字段上",
            )
            .to_compile_error()
            .into();
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

            let s = match subframe_size {
                Some(s) => s,
                None => {
                    return syn::Error::new_spanned(
                        f,
                        "带有 #[subframe] 的字段必须明确指定大小，例如: #[subframe(size = 6)]",
                    )
                    .to_compile_error()
                    .into();
                }
            };

            // 子帧 ID(1字节) + 子帧本身的大小
            compile_time_size_expr = quote! { #compile_time_size_expr + 1usize + #s };

            parse_quotes.push(quote! {
                let sub_frame_id = *data.get(offset).ok_or_else(|| "读取子帧ID越界".to_string())?;
                offset += 1;
                let sub_slice = data.get(offset..).ok_or_else(|| "读取子帧内容越界".to_string())?;
                let #field_name = <#field_type>::from_bytes(sub_frame_id, sub_slice)?;
                offset += #s;
            });
        } else if let Some(n) = bits_count {
            // ===== 位域字段（支持最多32位跨字节安全拼接） =====
            let byte_index = bit_cursor / 8;
            let bit_within_byte = bit_cursor % 8;
            let needed_bytes = (bit_within_byte + n + 7) / 8;
            let mask = if n >= 32 { !0u32 } else { (1u32 << n) - 1 };

            parse_quotes.push(quote! {
                let slice = data.get(offset + #byte_index .. offset + #byte_index + #needed_bytes)
                    .ok_or_else(|| format!("读取位域字段 {} 越界", stringify!(#field_name)))?;
                let mut buf = [0u8; 8];
                buf[..#needed_bytes].copy_from_slice(slice);
                let raw_u64 = u64::from_le_bytes(buf);
                let #field_name = (((raw_u64 >> #bit_within_byte) as u32) & #mask) as #field_type;
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
                let raw_type: proc_macro2::TokenStream = match raw_type_str.parse() {
                    Ok(t) => t,
                    Err(err) => return syn::Error::new_spanned(f, err.to_string()).to_compile_error().into(),
                };
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
                let factor: proc_macro2::TokenStream = match scale_factor
                    .unwrap_or_else(|| "1.0".to_string())
                    .parse()
                {
                    Ok(t) => t,
                    Err(err) => return syn::Error::new_spanned(f, err.to_string()).to_compile_error().into(),
                };
                let offset_val: proc_macro2::TokenStream = match scale_offset
                    .unwrap_or_else(|| "0.0".to_string())
                    .parse()
                {
                    Ok(t) => t,
                    Err(err) => return syn::Error::new_spanned(f, err.to_string()).to_compile_error().into(),
                };

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
                    let raw_type: proc_macro2::TokenStream = match raw_type_str.parse() {
                        Ok(t) => t,
                        Err(err) => return syn::Error::new_spanned(f, err.to_string()).to_compile_error().into(),
                    };
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

    let expected_payload_size = match expected_payload_size {
        Some(s) => s,
        None => {
            return syn::Error::new_spanned(
                &ast,
                "使用 FPPacketParser 必须在结构体上标注 #[frame(payload_size = N)] 以确保安全",
            )
            .to_compile_error()
            .into();
        }
    };

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

        #[automatically_derived]
        #[allow(unused_assignments, clippy::all)]
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

    let variants = match &ast.data {
        Data::Enum(data_enum) => &data_enum.variants,
        _ => {
            return syn::Error::new_spanned(&ast, "FPSubFrame 只能用于枚举")
                .to_compile_error()
                .into();
        }
    };

    let mut match_arms: Vec<proc_macro2::TokenStream> = Vec::new();

    for variant in variants {
        let variant_name = &variant.ident;

        // 解析 #[id(N)]
        let mut id_value: Option<u8> = None;
        for attr in &variant.attrs {
            if attr.path().is_ident("id") {
                let lit: LitInt = match attr.parse_args() {
                    Ok(l) => l,
                    Err(err) => return err.to_compile_error().into(),
                };
                match lit.base10_parse::<u8>() {
                    Ok(val) => id_value = Some(val),
                    Err(err) => return err.to_compile_error().into(),
                }
            }
        }
        let id = match id_value {
            Some(i) => i,
            None => {
                return syn::Error::new_spanned(
                    variant,
                    format!("子帧变体 {} 缺少 #[id(N)] 属性", variant_name),
                )
                .to_compile_error()
                .into();
            }
        };

        // 获取元组变体的内部类型（严格校验仅包含 1 个字段）
        let inner_type = match &variant.fields {
            Fields::Unnamed(fields) if fields.unnamed.len() == 1 => &fields.unnamed[0].ty,
            _ => {
                return syn::Error::new_spanned(
                    variant,
                    format!(
                        "子帧变体 {} 必须是且仅包含单个内部类型的元组形式，如 SF0(TypeName)",
                        variant_name
                    ),
                )
                .to_compile_error()
                .into();
            }
        };

        match_arms.push(quote! {
            #id => Ok(#enum_name::#variant_name(#inner_type::from_bytes(data)?)),
        });
    }

    let expanded = quote! {
        #[automatically_derived]
        #[allow(clippy::all)]
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

    let fields = match &ast.data {
        Data::Struct(data_struct) => match &data_struct.fields {
            Fields::Named(named_fields) => &named_fields.named,
            _ => {
                return syn::Error::new_spanned(&ast, "FPBitFlags 只能用于带命名字段的结构体")
                    .to_compile_error()
                    .into();
            }
        },
        _ => {
            return syn::Error::new_spanned(&ast, "FPBitFlags 只能用于结构体")
                .to_compile_error()
                .into();
        }
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
                let lit: LitInt = match attr.parse_args() {
                    Ok(l) => l,
                    Err(err) => return err.to_compile_error().into(),
                };
                match lit.base10_parse::<usize>() {
                    Ok(c) => skip_count += c,
                    Err(err) => return err.to_compile_error().into(),
                }
            } else if attr.path().is_ident("bits") {
                let lit: LitInt = match attr.parse_args() {
                    Ok(l) => l,
                    Err(err) => return err.to_compile_error().into(),
                };
                match lit.base10_parse::<usize>() {
                    Ok(c) => bits_count = Some(c),
                    Err(err) => return err.to_compile_error().into(),
                }
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
        #[automatically_derived]
        #[allow(clippy::all)]
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

    let default_name = format!("{}Aggregate", enum_name);
    let mut agg_struct_name = syn::Ident::new(&default_name, enum_name.span());
    let mut aggregate_rename_all: Option<LitStr> = None;
    for attr in &ast.attrs {
        if attr.path().is_ident("aggregate_struct") {
            if let Err(err) = attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("rename_all") {
                    aggregate_rename_all = Some(meta.value()?.parse()?);
                    Ok(())
                } else if meta.path.is_ident("name") {
                    let lit: LitStr = meta.value()?.parse()?;
                    agg_struct_name = syn::Ident::new(&lit.value(), lit.span());
                    Ok(())
                } else if let Some(ident) = meta.path.get_ident() {
                    agg_struct_name = ident.clone();
                    Ok(())
                } else {
                    Err(meta.error(format!(
                        "未知 #[aggregate_struct(...)] 属性参数: {}",
                        meta.path.get_ident().map(|i| i.to_string()).unwrap_or_default()
                    )))
                }
            }) {
                return err.to_compile_error().into();
            }
        }
    }

    let aggregate_serde_attr =
        aggregate_rename_all.map(|value| quote! { #[serde(rename_all = #value)] });

    let variants = match &ast.data {
        Data::Enum(data_enum) => &data_enum.variants,
        _ => {
            return syn::Error::new_spanned(&ast, "FPAggregate 只能用于枚举")
                .to_compile_error()
                .into();
        }
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

        let inner_ty = match &variant.fields {
            Fields::Unnamed(fields) if fields.unnamed.len() == 1 => &fields.unnamed[0].ty,
            _ => {
                return syn::Error::new_spanned(
                    variant,
                    format!(
                        "变体 {} 必须是且仅包含单个内部类型的元组形式，如 V1(TypeName)",
                        variant_ident
                    ),
                )
                .to_compile_error()
                .into();
            }
        };

        struct_fields.push(quote! { pub #field_name: Option<#inner_ty> });

        let mut sub_enum_ident: Option<syn::Ident> = None;
        let mut sub_field_ident: Option<syn::Ident> = None;
        let mut sub_items: Vec<(syn::Ident, syn::Ident, syn::Ident)> = Vec::new(); // (sub_variant, sub_ty, sub_field_name)

        for attr in &variant.attrs {
            if attr.path().is_ident("aggregate") {
                if let Err(err) = attr.parse_nested_meta(|meta| {
                    if meta.path.is_ident("sub_enum") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        sub_enum_ident = Some(syn::Ident::new(
                            &lit.value(),
                            proc_macro2::Span::call_site(),
                        ));
                        Ok(())
                    } else if meta.path.is_ident("sub_field") {
                        let value = meta.value()?;
                        let lit: LitStr = value.parse()?;
                        sub_field_ident = Some(syn::Ident::new(
                            &lit.value(),
                            proc_macro2::Span::call_site(),
                        ));
                        Ok(())
                    } else if meta.path.is_ident("subs") {
                        meta.parse_nested_meta(|sub_meta| {
                            let sub_variant = match sub_meta.path.get_ident() {
                                Some(i) => i.clone(),
                                None => return Err(sub_meta.error("subs 变体名称必须是标识符")),
                            };
                            let mut sub_ty: Option<syn::Ident> = None;
                            sub_meta.parse_nested_meta(|inner_meta| {
                                sub_ty = inner_meta.path.get_ident().cloned();
                                Ok(())
                            })?;
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
                        })
                    } else {
                        Err(meta.error(format!(
                            "未知 #[aggregate(...)] 属性参数: {}",
                            meta.path.get_ident().map(|i| i.to_string()).unwrap_or_default()
                        )))
                    }
                }) {
                    return err.to_compile_error().into();
                }
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

        #[automatically_derived]
        #[allow(clippy::all)]
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
