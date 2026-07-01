import { file } from "src/sandbox/types/blueprints";
import { ScreenRenderer } from "../grid/ScreenRenderer";
import { useCode } from "src/sandbox/_providers/CodeContextProvider";
import { useBlueprints } from "src/sandbox/_providers/BlueprintsContextProvider";
import { useBuilderPanel } from "src/sandbox/_providers/BuilderPanelContextProvider";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFile } from "@fortawesome/free-solid-svg-icons";
import Dropdown from "src/_components/Dropdown";
import { viewportMapping, Viewports } from "src/sandbox/types/viewportMapping";
import { useEffect } from "react";

export default function Render({
  file,
  setFile
}: {
  file: file;
  setFile: (fileUpdate: Partial<file>) => void;
}) {

  useEffect(() => {
    console.log(viewportMapping[file.viewport ?? Viewports.NONE])
    console.log(file.viewport)
  }, [file.viewport])

  const screenSize = file.viewport && file.viewport !== Viewports.NONE
    ? viewportMapping[file.viewport]
    : null;

  const {
    setCodeWindows,
    activeCodeWindow,
    setActiveCodeWindow
  } = useCode();

  const {
    setBlueprints,
    highlightInstances
  } = useBlueprints();

  const {
    prevBuilderMenuMode,
    setBuilderMenuMode,
    setWindowDividerPosition
  } = useBuilderPanel();

  return (
    <div
      key={file.id}
      style={{
        position: 'absolute',
        left: file.position.x,
        top: file.position.y,
      }}
    >
      <ScreenRenderer
        id={file.id}
        name={file.name}
        code={file.code}
        // style={{
        //   width: viewportMapping[file.viewport ?? Viewports.NONE].width ?? 0,
        //   height: viewportMapping[file.viewport ?? Viewports.NONE].height ?? 0,
        // }}
        style={screenSize ? {
          width: screenSize.width ?? 0,
          height: screenSize.height ?? 0,
        } : {}}
        className={`
          VIEW overflow-hidden text-text
          ${highlightInstances ? "outline-4 rounded-3xl" : "pointer-events-auto"}
          ${highlightInstances && file.id != activeCodeWindow ? "outline-border hover:outline-border2 cursor-pointer" : ""}
          ${highlightInstances && file.id == activeCodeWindow ? "outline-border2" : ""}
        `}
        onClick={() => {
          setBuilderMenuMode(prevBuilderMenuMode);
          setWindowDividerPosition(prev => prev || 50);
          setCodeWindows(prev => {
            const exists = prev.find(cw => cw.id === file.id);
            if (exists) {
              return prev;
            }
            return [
              ...prev,
              {
                id: file.id,
                name: file.name,
                code: file.code
              }
            ]
          })
          setActiveCodeWindow(file.id);
        }}
      />

      <div
        className="bg-background2 border h-10 border-border2/50 text-text text-sm absolute top-0 left-0 -translate-y-[200%] rounded-xl flex"
      >
        <Dropdown
          items={Viewports ? Object.values(Viewports) : []}
          itemsPlaceholder={Viewports ? Object.values(Viewports) : []}
          placeholder="Select viewport"
          onChange={(v: Viewports) => { setFile({ viewport: v }); }}
          value={file.viewport}
          className="px-4"
        />
        <div className="w-[1px] h-full bg-border2"></div>
        <div
          className="MENU flex gap-2 items-center px-4 cursor-pointer"
          onClick={() => {
            setFile({ viewMode: 'card' });
          }}
        >
          <FontAwesomeIcon icon={faFile} />
          <h3 className="text-nowrap">Unrender file</h3>
        </div>
      </div>
    </div>
  )
}