// Public API of the reports module (monthly reports + period closes).
// Other modules consume use cases and read models exposed here; internal
// layers (domain/, application/, infrastructure/) are not importable.
export {
  PeriodClose,
  calendarMonthPeriod,
  isCalendarMonthFinished,
  type PeriodCloseState,
  type MonthPeriod,
} from "./domain/period-close.js";
export {
  PERIOD_CLOSE_REPOSITORY,
  type PeriodCloseRepositoryPort,
} from "./application/ports/period-close-repository.port.js";
export {
  ClosePeriodUseCase,
  type ClosePeriodCommand,
} from "./application/close-period.use-case.js";
export { ListPeriodClosesUseCase } from "./application/list-period-closes.use-case.js";
export {
  toPeriodCloseView,
  type PeriodCloseView,
} from "./application/period-close.view.js";
