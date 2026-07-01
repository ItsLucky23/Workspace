declare const confetti: (options: { particleCount: number; spread: number; origin: { y: number } }) => void;

//? function makes confetti appear on the screen
export default function launchConfetti(): void {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });
  } else {
    console.warn("Confetti script is not loaded yet.");
  }
};