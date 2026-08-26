type WorkerRequest = { url: string }

type WorkerResponse =
  | { ok: true; coordinates: ArrayBuffer; offsets: ArrayBuffer }
  | { ok: false; error: string }

function isPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  )
}

function collectRings(value: unknown, rings: number[][]) {
  if (!Array.isArray(value) || value.length === 0) return
  if (Array.isArray(value[0]) && isPosition(value[0])) {
    const ring: number[] = []
    value.forEach((position) => {
      if (isPosition(position)) ring.push(position[0], position[1])
    })
    if (ring.length >= 4) rings.push(ring)
    return
  }
  value.forEach((child) => collectRings(child, rings))
}

function collectGeometry(geometry: any, rings: number[][]) {
  if (!geometry) return
  if (geometry.type === 'GeometryCollection') {
    geometry.geometries?.forEach((item: any) => collectGeometry(item, rings))
    return
  }
  if (geometry.coordinates) collectRings(geometry.coordinates, rings)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const fetchResponse = await fetch(event.data.url)
    if (!fetchResponse.ok) throw new Error(`HTTP ${fetchResponse.status}`)
    const data = await fetchResponse.json()
    const rings: number[][] = []
    const features = Array.isArray(data.features) ? data.features : [data]
    features.forEach((feature: any) => collectGeometry(feature.geometry, rings))
    const offsets = new Uint32Array(rings.length + 1)
    const coordinateCount = rings.reduce(
      (total, ring) => total + ring.length,
      0,
    )
    const coordinates = new Float64Array(coordinateCount)
    let offset = 0
    rings.forEach((ring, index) => {
      coordinates.set(ring, offset)
      offset += ring.length
      offsets[index + 1] = offset
    })
    const response: WorkerResponse = {
      ok: true,
      coordinates: coordinates.buffer,
      offsets: offsets.buffer,
    }
    // 转移数组所有权，避免把成千上万个嵌套数组结构化克隆回主线程。
    self.postMessage(response, [coordinates.buffer, offsets.buffer])
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse)
  }
}

export {}
