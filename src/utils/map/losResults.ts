export function mergeLosVisibilityResults(resultsByViewPoint: boolean[][]) {
  const sampleCount = resultsByViewPoint[0]?.length ?? 0

  return Array.from({ length: sampleCount }, (_, sampleIndex) =>
    resultsByViewPoint.some((results) => results[sampleIndex] === true),
  )
}
