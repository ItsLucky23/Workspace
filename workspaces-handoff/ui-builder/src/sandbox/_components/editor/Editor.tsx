import { faClose, faCode, faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCode } from "src/sandbox/_providers/CodeContextProvider";
import BuilderMenu from "./BuilderMenu";
import CodeEditor from "./CodeEditor";
import { memo, useEffect } from "react";
import { BuilderMenuMode, useBuilderPanel } from "src/sandbox/_providers/BuilderPanelContextProvider";

const Editor = () => {

  const { builderMenuMode, setBuilderMenuMode } = useBuilderPanel();

  const {
    codeWindows,
    setCodeWindows,
    activeCodeWindow,
    setActiveCodeWindow
  } = useCode();

  useEffect(() => {
    if (codeWindows.length === 0) {
      setBuilderMenuMode(BuilderMenuMode.CLOSED);
    }

  }, [builderMenuMode, codeWindows, activeCodeWindow]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* BUILDER MENU CONTENT HERE PLEASE */}
      <div className="w-full pt-2 pr-2 border-b border-border flex">
        <div className="group/tabs flex flex-1 max-w-[calc(100%-100px)] overflow-y-hidden ">
          {codeWindows.map((cw, index) => (
            <div 
              key={index} 
              className={`
                group p-2 flex gap-2 items-center text-text transition-all duration-200 flex-shrink-0 min-w-0 max-w-60
                ${cw.id == activeCodeWindow ? "bg-background" : "cursor-pointer hover:bg-background"}
              `}
              onClick={() => setActiveCodeWindow(cw.id)}
            >
              <img src="/languages/react.png" alt={cw.name} className="w-4 flex-shrink-0" />
              <h1 className="select-none truncate flex-1 min-w-0">
                {cw.name?.includes('.') ? cw.name : `${cw.name || 'Untitled'}.tsx`}
              </h1>
              <div className="flex items-center justify-center flex-shrink-0">
                <div className={`hover:bg-background2 px-0.5 rounded transition-all duration-200 ${cw.id == activeCodeWindow ? "" : "opacity-0 group-hover:opacity-100"} `}>
                  <FontAwesomeIcon
                    className={`cursor-pointer text-muted`}
                    icon={faClose}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveCodeWindow(
                        codeWindows[index - 1] ? codeWindows[index - 1].id :
                        codeWindows[index + 1] ? codeWindows[index + 1].id :
                        ""
                      );
                      setCodeWindows(prev => prev.filter(w => w.id !== cw.id))
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="ml-auto flex">
          <div 
            className={`p-2 gap-2 flex items-center justify-center text-text ${builderMenuMode == BuilderMenuMode.CODE ? "bg-background" : "cursor-pointer hover:bg-background bg-background2"}`}
            onClick={() => setBuilderMenuMode(BuilderMenuMode.CODE)}
          >
            <FontAwesomeIcon
            className="text-text"
            icon={faCode}
            ></FontAwesomeIcon>
            {/* <h1>Code</h1> */}
          </div>
          <div 
            className={`p-2 gap-2 flex items-center justify-center text-text ${builderMenuMode == BuilderMenuMode.BUILDER ? "bg-background" : "cursor-pointer hover:bg-background bg-background2"}`}
            onClick={() => setBuilderMenuMode(BuilderMenuMode.BUILDER)}
          >
            <FontAwesomeIcon
            icon={faPenToSquare}
            ></FontAwesomeIcon>
            {/* <h1>Builder</h1> */}
          </div>
        </div>

      </div>
      <div className="h-full w-full">
        {builderMenuMode === BuilderMenuMode.CODE ? (
          <CodeEditor />
        ) : builderMenuMode === BuilderMenuMode.BUILDER ? (
          <BuilderMenu />
        ) : null}
      </div>
    </div>
  )
}

export default memo(Editor);

          // <div className="flex">
          //   <div 
          //     className={`group py-2 px-4 flex gap-2 items-center border-b-2 transition-border duration-200
          //       ${builderMenuMode === BuilderMenuMode.CODE ? "border-title" : "hover:border-muted border-transparent cursor-pointer"}
          //     `}
          //     onClick={() => { setBuilderMenuMode(BuilderMenuMode.CODE) }}
          //   >
          //     <div 
          //       className="flex gap-2 items-center"
          //     >
          //       <FontAwesomeIcon
          //         icon={faCode}
          //       ></FontAwesomeIcon>
          //       <h1>Code</h1>
          //     </div>
          //     <FontAwesomeIcon
          //       className={`text-muted cursor-pointer hover:text-title ${builderMenuMode == BuilderMenuMode.CODE ? "" : "opacity-0"} group-hover:opacity-100`}
          //       onClick={(e) => { 
          //         e.stopPropagation();
          //         setBuilderMenuMode(BuilderMenuMode.CLOSED);
          //         setActiveCodeWindow(null);
          //       }}
          //       icon={faClose}
          //     ></FontAwesomeIcon>
          //   </div>
          //   <div 
          //     className={`group py-2 px-4 flex gap-2 items-center border-b-2 transition-border duration-200
          //       ${builderMenuMode === BuilderMenuMode.BUILDER ? "border-title" : "hover:border-muted border-transparent cursor-pointer"}
          //     `}
          //     onClick={() => { setBuilderMenuMode(BuilderMenuMode.BUILDER) }}
          //   >
          //     <div 
          //       className="flex gap-2 items-center"
          //     >
          //       <FontAwesomeIcon
          //         icon={faPenToSquare}
          //       ></FontAwesomeIcon>
          //       <h1>Builder</h1>
          //     </div>
          //     <FontAwesomeIcon
          //       className={`text-muted cursor-pointer hover:text-title ${builderMenuMode == BuilderMenuMode.BUILDER ? "" : "opacity-0"} group-hover:opacity-100`}
          //       onClick={(e) => { 
          //         e.stopPropagation();
          //         setBuilderMenuMode(BuilderMenuMode.CLOSED);
          //         setActiveCodeWindow(null);
          //       }}
          //       icon={faClose}
          //     ></FontAwesomeIcon>
          //   </div>
          // </div>