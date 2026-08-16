import { describe, expect, it } from 'vitest';
import {
  type MonitorStatus,
  type StateMachineInput,
  nextState,
} from '../src/modules/checker/checker.state-machine.js';

/**
 * Drives a sequence of check results through the state machine, threading the resulting
 * counters into the next call the way the real check-write loop does. Returns the status
 * after each step, so a whole outage/recovery narrative reads as one assertion.
 */
function run(
  results: boolean[],
  opts: { failureThreshold?: number; recoveryThreshold?: number; from?: MonitorStatus } = {},
): MonitorStatus[] {
  let state: StateMachineInput = {
    status: opts.from ?? 'pending',
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    failureThreshold: opts.failureThreshold ?? 3,
    recoveryThreshold: opts.recoveryThreshold ?? 3,
  };

  return results.map((succeeded) => {
    const next = nextState(state, succeeded);
    state = { ...state, ...next };
    return next.status;
  });
}

const OK = true;
const FAIL = false;

describe('monitor state machine', () => {
  it('marks a never-checked monitor up on its first success, without waiting for the recovery threshold', () => {
    expect(run([OK])).toEqual(['up']);
  });

  it('walks up -> suspected_down -> down only after the failure threshold is met', () => {
    expect(run([OK, FAIL, FAIL, FAIL])).toEqual(['up', 'suspected_down', 'suspected_down', 'down']);
  });

  it('walks down -> suspected_up -> up only after the recovery threshold is met', () => {
    expect(run([OK, FAIL, FAIL, FAIL, OK, OK, OK])).toEqual([
      'up',
      'suspected_down',
      'suspected_down',
      'down',
      'suspected_up',
      'suspected_up',
      'up',
    ]);
  });

  it('stays down without re-transitioning while failures continue', () => {
    const results = run([OK, FAIL, FAIL, FAIL, FAIL, FAIL]);
    expect(results.slice(3)).toEqual(['down', 'down', 'down']);
  });

  // The core flapping-protection claim: a single failed check inside a healthy run must
  // never produce a 'down', because that is what would page someone at 3am for nothing.
  it('absorbs an isolated failure without ever going down', () => {
    const results = run([OK, OK, FAIL, OK, OK]);
    expect(results).toEqual(['up', 'up', 'suspected_down', 'up', 'up']);
    expect(results).not.toContain('down');
  });

  it('absorbs an isolated success during an outage without declaring recovery', () => {
    const results = run([OK, FAIL, FAIL, FAIL, OK, FAIL, FAIL, FAIL]);
    expect(results.slice(4)).toEqual(['suspected_up', 'suspected_down', 'suspected_down', 'down']);
  });

  it('resets a partial failure streak once a success lands', () => {
    // Two failures (threshold 3), then a success, then two more failures: without the
    // reset the monitor would hit 3 cumulative failures and wrongly go down.
    expect(run([OK, FAIL, FAIL, OK, FAIL, FAIL])).toEqual([
      'up',
      'suspected_down',
      'suspected_down',
      'up',
      'suspected_down',
      'suspected_down',
    ]);
  });

  it('goes straight up -> down with no suspected_down tick when failureThreshold is 1', () => {
    expect(run([OK, FAIL], { failureThreshold: 1 })).toEqual(['up', 'down']);
  });

  it('goes straight down -> up with no suspected_up tick when recoveryThreshold is 1', () => {
    expect(run([OK, FAIL], { failureThreshold: 1, recoveryThreshold: 1 }).concat(
      run([FAIL, OK], { failureThreshold: 1, recoveryThreshold: 1, from: 'up' }).slice(1),
    )).toEqual(['up', 'down', 'up']);
  });

  it('honours per-monitor thresholds rather than a fixed global value', () => {
    expect(run([OK, FAIL, FAIL], { failureThreshold: 5 })).toEqual(['up', 'suspected_down', 'suspected_down']);
    expect(run([OK, FAIL, FAIL], { failureThreshold: 2 })).toEqual(['up', 'suspected_down', 'down']);
  });

  it('reports statusChanged only on the tick the status actually moves', () => {
    const base: StateMachineInput = {
      status: 'up',
      consecutiveFailures: 0,
      consecutiveSuccesses: 5,
      failureThreshold: 2,
      recoveryThreshold: 2,
    };

    expect(nextState(base, OK).statusChanged).toBe(false);

    const firstFailure = nextState(base, FAIL);
    expect(firstFailure).toMatchObject({ status: 'suspected_down', statusChanged: true });

    const secondFailure = nextState({ ...base, ...firstFailure }, FAIL);
    expect(secondFailure).toMatchObject({ status: 'down', statusChanged: true });

    const thirdFailure = nextState({ ...base, ...secondFailure }, FAIL);
    expect(thirdFailure).toMatchObject({ status: 'down', statusChanged: false });
  });

  it('keeps the opposing counter cleared in steady state, so a later streak starts from zero', () => {
    const down = nextState(
      {
        status: 'down',
        consecutiveFailures: 9,
        consecutiveSuccesses: 0,
        failureThreshold: 3,
        recoveryThreshold: 3,
      },
      FAIL,
    );
    expect(down.consecutiveSuccesses).toBe(0);

    const up = nextState(
      {
        status: 'up',
        consecutiveFailures: 0,
        consecutiveSuccesses: 9,
        failureThreshold: 3,
        recoveryThreshold: 3,
      },
      OK,
    );
    expect(up.consecutiveFailures).toBe(0);
  });
});
