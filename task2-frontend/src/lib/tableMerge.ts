export interface Page<T extends { id: number }> {
  data: T[]
  total: number
  page: number
  page_size: number
}

export interface MergeResult {
  orderChanged: boolean
}

export function mergeRefreshedPage<T extends { id: number }>(
  current: Page<T>,
  fresh: Page<T>,
): Page<T> & MergeResult {
  if (current.data.length === 0) {
    return { ...fresh, orderChanged: false }
  }
  const freshById = new Map(fresh.data.map((row) => [row.id, row]))
  const sameOrder =
    fresh.data.length === current.data.length &&
    fresh.data.every((row, index) => row.id === current.data[index]?.id)
  return {
    ...fresh,
    data: current.data.map((row) => freshById.get(row.id) ?? row),
    orderChanged: !sameOrder,
  }
}
