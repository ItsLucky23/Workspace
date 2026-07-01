import Grid from "./_components/grid/Grid";
import Editor from "./_components/editor/Editor";
import useOnMouseDown from "./_functions/grid/onMouseDown";
import { BuilderMenuMode, useBuilderPanel } from "./_providers/BuilderPanelContextProvider";
import { setMenuHandlerRef } from "src/_functions/menuHandler";
import { useMenuHandler } from "src/_components/MenuHandler";

export const template = 'sandbox';
export default function Home() {

  const ref = useMenuHandler();
  setMenuHandlerRef(ref);

  const {
    windowDividerDragging,
    builderMenuMode,
    windowDividerPosition,
  } = useBuilderPanel();

  const { handleWindowDivider } = useOnMouseDown();

  return (
    <div className="h-full w-full">

      <div className="flex h-full w-full relative">

        <div
          id="leftPanel"
          className={`
            h-full w-full bg-background 
            ${windowDividerDragging.current ? "" : "transition-all duration-300"}
          `}
          style={{
            width: builderMenuMode != "CLOSED" ? `${windowDividerPosition || 50}%` : '100%',
          }}
        >

          {/* <div className="flex h-[calc(100%-40px)]"> */}
          <div className="flex h-full">
            <Grid />
          </div>

        </div>

        <div
          className={`bg-background2 h-full w-2 ${builderMenuMode == BuilderMenuMode.CLOSED ? "hidden" : ""} cursor-col-resize`}
          onMouseDown={(e) => handleWindowDivider(e.nativeEvent)}
        ></div>

        <div
          id="rightPanel"
          className={`
            flex flex-col h-full bg-background2 overflow-hidden ${builderMenuMode == BuilderMenuMode.CLOSED ? "" : ""}
            ${windowDividerDragging.current ? "" : "transition-all duration-300"}
          `}
          style={{
            width: builderMenuMode != BuilderMenuMode.CLOSED ? `${100 - (windowDividerPosition || 50)}%` : '0%',
          }}
        >

          <Editor />
        </div>
      </div>
    </div>
  );
};
