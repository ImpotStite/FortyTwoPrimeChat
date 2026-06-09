const STORAGE_KEY_PRIME = "fortytwo-prime-onboarding-completed-v1";

const STORAGE_KEY_TEST = "fortytwo-prime-onboarding-test-completed-v1";

export function isPrimeOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_PRIME) === "1";
  } catch {
    return false;
  }
}

export function markPrimeOnboardingCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY_PRIME, "1");
  } catch {
  }
}

export function isTestOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_TEST) === "1";
  } catch {
    return false;
  }
}

export function markTestOnboardingCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY_TEST, "1");
  } catch {
  }
}
