declare module 'shpjs' {
  type ShapefileInput = {
    shp: ArrayBuffer
    dbf?: ArrayBuffer
    prj?: string
    cpg?: ArrayBuffer | string
  }

  const parseShapefile: (input: ShapefileInput) => Promise<any>
  export default parseShapefile
}
