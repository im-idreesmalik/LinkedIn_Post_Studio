import { OnboardingForm } from "@/components/onboarding-form";

export default function OnboardingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Tell us about your expertise</h1>
        <p className="text-sm text-gray-500">
          We tailor your daily posts from this. Pasting a few of your own past posts
          teaches the tool your voice (we never read your LinkedIn history directly).
        </p>
      </div>
      <OnboardingForm initial={{}} redirectTo="/" />
    </div>
  );
}
