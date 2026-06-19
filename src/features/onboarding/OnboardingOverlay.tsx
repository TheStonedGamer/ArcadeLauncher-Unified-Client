// First-run guided overlay: a centered card stepping through ONBOARDING_STEPS
// with Back/Next, dot indicators, and Skip. Calls onFinish() on Skip or the final
// "Get started". Pure presentation — completion state lives in useOnboarding.

import { useState } from "react";
import { ONBOARDING_STEPS, clampStep, isLastStep } from "./onboarding";

interface Props {
  onFinish: () => void;
}

export function OnboardingOverlay({ onFinish }: Props) {
  const total = ONBOARDING_STEPS.length;
  const [index, setIndex] = useState(0);
  const step = ONBOARDING_STEPS[index];
  const last = isLastStep(index, total);

  const go = (delta: number) => setIndex((i) => clampStep(i + delta, total));

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding__card">
        <div className="onboarding__step-count">
          Step {index + 1} of {total}
        </div>
        <h2 id="onboarding-title" className="onboarding__title">
          {step.title}
        </h2>
        <p className="onboarding__body">{step.body}</p>

        <div className="onboarding__dots" aria-hidden="true">
          {ONBOARDING_STEPS.map((s, i) => (
            <span key={s.id} className={`onboarding__dot${i === index ? " onboarding__dot--on" : ""}`} />
          ))}
        </div>

        <div className="onboarding__actions">
          <button type="button" className="onboarding__skip" onClick={onFinish}>
            Skip
          </button>
          <div className="onboarding__nav">
            {index > 0 && (
              <button type="button" className="onboarding__btn" onClick={() => go(-1)}>
                Back
              </button>
            )}
            {last ? (
              <button type="button" className="onboarding__btn onboarding__btn--primary" onClick={onFinish}>
                Get started
              </button>
            ) : (
              <button type="button" className="onboarding__btn onboarding__btn--primary" onClick={() => go(1)}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
