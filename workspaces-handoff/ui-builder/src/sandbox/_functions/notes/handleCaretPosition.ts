import { useGrid } from "src/sandbox/_providers/GridContextProvider";
import { CaretPosition } from "./getCaretPosition";

export const handleCaretPositionChange = () => {

  const {
    setOffset
  } = useGrid();

  return (position: CaretPosition | null) => {
    if (!position) { return; }

    setOffset(prev => {
      let newY = prev.y;
      const absoluteY = position.absoluteY;
      const windowHeight = window.innerHeight;
      if (absoluteY > windowHeight * 0.65) {
        const remaining = (windowHeight * 0.65) - absoluteY;
        newY = prev.y + remaining;
      } else if (absoluteY < windowHeight * 0.35) {
        const remaining = (windowHeight * 0.35) - absoluteY;
        newY = prev.y + remaining;
      }
      return { ...prev, y: newY };
    })
  }
};