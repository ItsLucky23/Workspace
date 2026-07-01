const COLORS: Record<string, string> = {
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  reset: "\x1b[0m",
};

export const initConsolelog = () => {
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    const stack = new Error().stack?.split("\n")[2]?.trim();
    if (!stack) return originalLog(...args);
  
    let lineInfo = stack.substring(stack.indexOf("(") + 1, stack.lastIndexOf(")"));
    if (lineInfo === "") lineInfo = stack;
    const extractedInfo = lineInfo
      .substring(lineInfo.lastIndexOf("\\") + 1)
      .replace(/:\d+$/, "");
  
    // find color keyword and remove it from args
    let colorCode = COLORS.white;
    for (const key of Object.keys(COLORS)) {
      const index = args.findIndex((a) => a === key);
      if (index !== -1) {
        colorCode = COLORS[key];
        args.splice(index, 1);
        break;
      }
    }
  
    // handle object vs text
    if (typeof args[0] === "object") {
      originalLog(`${colorCode}${extractedInfo}${COLORS.reset}`);
      originalLog(args);
    } else {
      originalLog(`${colorCode}${extractedInfo} -- ${args.join(" ")}${COLORS.reset}`);
    }
  };
}