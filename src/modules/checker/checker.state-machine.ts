export type MonitorStatus = 'pending' | 'up' | 'suspected_down' | 'down' | 'suspected_up';

export interface StateMachineInput {
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  failureThreshold: number;
  recoveryThreshold: number;
}

export interface StateMachineResult {
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  /** True only on the tick where status actually changed, so callers can act on the edge. */
  statusChanged: boolean;
}

/**
 * Pure transition function: up -> suspected_down -> down and back, requiring N consecutive
 * results to commit a transition so a single blip never flips a monitor (DECISIONS.md #8).
 *
 * Kept free of I/O deliberately -- every flapping/threshold scenario is then testable as
 * plain function calls, with no database or HTTP involved.
 *
 * A monitor with failure_threshold = 1 goes straight up -> down with no intermediate
 * suspected_down tick; the suspected_* states only exist while a streak is still building.
 */
export function nextState(input: StateMachineInput, checkSucceeded: boolean): StateMachineResult {
  const { status, failureThreshold, recoveryThreshold } = input;

  if (checkSucceeded) {
    const consecutiveSuccesses = input.consecutiveSuccesses + 1;

    // Already healthy: stay put, but keep the failure streak cleared.
    if (status === 'up') {
      return { status: 'up', consecutiveFailures: 0, consecutiveSuccesses, statusChanged: false };
    }

    // The recovery threshold only applies to monitors that actually reached 'down'. Two
    // cases skip it entirely:
    //   - 'pending': never checked, so there is no outage to recover from -- requiring N
    //     successes would leave a brand-new working monitor looking unhealthy.
    //   - 'suspected_down': the failure streak never reached the threshold, so the monitor
    //     was never down. This is exactly the isolated-blip case flapping protection
    //     exists for; making it serve a recovery streak would punish a monitor for a
    //     wobble it already recovered from on the very next check.
    // statusChanged is unconditionally true here: the status === 'up' case returned above,
    // so reaching this line always means a real transition into 'up'.
    if (status === 'pending' || status === 'suspected_down' || consecutiveSuccesses >= recoveryThreshold) {
      return { status: 'up', consecutiveFailures: 0, consecutiveSuccesses, statusChanged: true };
    }

    // Genuine recovery in progress: from 'down' this is the first step into suspected_up,
    // from 'suspected_up' it's the streak continuing toward recoveryThreshold.
    return {
      status: 'suspected_up',
      consecutiveFailures: 0,
      consecutiveSuccesses,
      statusChanged: status !== 'suspected_up',
    };
  }

  const consecutiveFailures = input.consecutiveFailures + 1;

  // Already down: stay put, but keep the success streak cleared.
  if (status === 'down') {
    return { status: 'down', consecutiveFailures, consecutiveSuccesses: 0, statusChanged: false };
  }

  if (consecutiveFailures >= failureThreshold) {
    return { status: 'down', consecutiveFailures, consecutiveSuccesses: 0, statusChanged: true };
  }

  return {
    status: 'suspected_down',
    consecutiveFailures,
    consecutiveSuccesses: 0,
    statusChanged: status !== 'suspected_down',
  };
}
