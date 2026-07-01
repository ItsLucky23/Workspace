// Tooltip.tsx
import { useState, useRef, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
  vertical?: "top" | "bottom"; // top or bottom
  horizontal?: "left" | "right"; // left, right
  offsetX?: number | string; // horizontal offset
  offsetY?: number | string; // vertical offset
  className?: string;
  condition?: boolean;
}

export default function Tooltip({
  content,
  children,
  delay = 0,
  offsetX = 0,
  offsetY = 0,
  className = "",
  condition
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setVisible(false);
  };

  // calculate absolute positioning
  const style: React.CSSProperties = {};

  if (typeof offsetY === "number") {
    // style.top = `${offsetY}px`;
    style.top = `calc(100% + ${offsetY}px)`;
  } else if (typeof offsetY === "string") {
    style.top = `calc(100% + ${offsetY})`;
  }

  if (typeof offsetX === "number") {
    style.left = `${offsetX}px`;
  } else if (typeof offsetX === "string") {
    style.left = `calc(${offsetX})`;
  }

  // simple animation based on vertical
  // const initial = { opacity: 0, y: vertical === "top" ? -5 : 5 };
  const initial = { opacity: 0, y: -5 };
  const animate = { opacity: 1, y: 0 };
  // const exit = { opacity: 0, y: vertical === "top" ? -5 : 5 };
  const exit = { opacity: 0, y: -5 };

  return (
    <div
      style={{ 
        display: "inline-flex", 
        position: "relative",
      }}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      {children}

      <AnimatePresence>
        {visible && (condition === undefined || condition) && (
          <motion.div
            initial={initial}
            animate={animate}
            exit={exit}
            transition={{ duration: 0.2 }}
            style={{
              position: "absolute",
              zIndex: 999,
              ...style,
            }}
          >
            <div className={`select-none ${className}`}>
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
