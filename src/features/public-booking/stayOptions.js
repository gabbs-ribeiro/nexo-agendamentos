const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

export function hasNoFurtherStayOptionThatDay(options, selectedOption) {
  if (!selectedOption) return false
  const nextCheckOut = Date.parse(selectedOption.check_out_at) + TWELVE_HOURS_MS
  return !options.some((option) => option.check_out === selectedOption.check_out
    && Date.parse(option.check_out_at) === nextCheckOut)
}
