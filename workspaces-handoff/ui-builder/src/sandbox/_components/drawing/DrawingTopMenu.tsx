
import { ErasingMode, useDrawing } from "src/sandbox/_providers/DrawingContextProvider";
import { useEffect, useState, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEraser, faPencilAlt, faAlignCenter, faSquare, faCircle, faDiamond, faMousePointer, faSlash, faRulerCombined, faArrowRight, faFillDrip, faDownload, faObjectGroup, faFont } from "@fortawesome/free-solid-svg-icons";
import { clipStrokesToRect } from "src/sandbox/_functions/drawing/clipUtils";
import Tooltip from "src/_components/Tooltip";

export default function DrawingTopMenu() {

  const {
    drawingEnabled,
    erasing,
    setErasing,
    activeShape,
    setActiveShape,
    selectionMode,
    setSelectionMode,
    showMeasurements,
    setShowMeasurements,
    showDrawings,
    selectedStrokeIds,
    setSelectedStrokeIds,
    strokes,
    marqueeMode,
    setMarqueeMode,
    marqueeBox,
    setMarqueeBox,
    fillMode,
    setFillMode,
    textMode,
    setTextMode
  } = useDrawing();

  const [lastErasingMode, setLastErasingMode] = useState<ErasingMode>(ErasingMode.DISABLED);
  const [erasingOptionMenu, setErasingOptionMenu] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [_, setOpenColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setOpenColorPicker(false);
      }

      if (!(event.target as HTMLElement).closest('.drawingOptionMenu')) {
        setErasingOptionMenu(false);
        setExportMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [])

  useEffect(() => {
    setActiveShape(null)
    setErasing(ErasingMode.DISABLED)
  }, [showDrawings])

  useEffect(() => {
    setLastErasingMode(erasing);
  }, [erasing]);

  return (
    <div 
      className={`
        absolute top-4 left-1/2 -translate-x-1/2 z-50 
        flex gap-4 select-none items-start text-text 
        transition-all duration-200 origin-top
        ${drawingEnabled ? 'opacity-100 scale-100' : 'opacity-0 scale-80'}
      `}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="bg-background2 border p-2 gap-2 flex border-border2 rounded-lg">
        {/* Selection Mode */}
        <Tooltip
          content={"Select Tool"}
          offsetY={"100% - 12px"}
          offsetX={"50%"}
          className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
        >
          <button
            className={`
              flex p-2 text-text border-b 
              ${selectionMode ? 'border-text' : 'hover:bg-background2-hover rounded border-transparent'}
            `}
            onClick={() => {
              setErasing(ErasingMode.DISABLED)
              setActiveShape(null)
              setSelectionMode(true)
              setFillMode(false)
              setTextMode(false)
              setMarqueeMode(false)
              setMarqueeBox(null)
              setSelectedStrokeIds([])
            }}
          >
            <FontAwesomeIcon icon={faMousePointer} size="xs" />
          </button>
        </Tooltip>

        {/* Area Select (Marquee) */}
        <Tooltip
          content={"Area Select (Marquee)"}
          offsetY={"100% - 12px"}
          offsetX={"50%"}
          className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
        >
          <button
            className={`
              flex p-2 text-text border-b 
              ${marqueeMode ? 'border-text' : 'hover:bg-background2-hover rounded border-transparent'}
            `}
            onClick={() => {
              setErasing(ErasingMode.DISABLED)
              setActiveShape(null)
              setSelectionMode(false)
              setFillMode(false)
              setTextMode(false)
              setMarqueeMode(true)
              setSelectedStrokeIds([])
            }}
          >
            <FontAwesomeIcon icon={faObjectGroup} size="xs" />
          </button>
        </Tooltip>
      </div>

      <div className="flex gap-2 p-2 bg-background2 border border-border2 rounded-lg">
        {/* Draw mode */}
        <Tooltip
          content={"Draw mode"}
          offsetY={"100% - 12px"}
          offsetX={"50%"}
          className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
        >
          <button
            className={`
              flex p-2 text-text border-b 
              ${!erasing && !activeShape && !selectionMode && !fillMode && !marqueeMode && !textMode ? 'border-text' : 'hover:bg-background2-hover rounded border-transparent'}
            `}
            onClick={() => {
              setErasing(ErasingMode.DISABLED)
              setActiveShape(null)
              setSelectionMode(false)
              setFillMode(false)
              setTextMode(false)
              setMarqueeMode(false)
              setSelectedStrokeIds([])
            }}
          >
            <FontAwesomeIcon icon={faPencilAlt} size="xs" />
          </button>
        </Tooltip>

        {/* Fill Tool */}
        <Tooltip
          content={"Fill Tool"}
          offsetY={"100% - 12px"}
          offsetX={"50%"}
          className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
        >
          <button
            className={`
              flex p-2 text-text border-b 
              ${fillMode ? 'border-text' : 'hover:bg-background2-hover rounded border-transparent'}
            `}
            onClick={() => {
              setErasing(ErasingMode.DISABLED)
              setActiveShape(null)
              setSelectionMode(false)
              setFillMode(true)
              setTextMode(false)
              setMarqueeMode(false)
              setSelectedStrokeIds([])
            }}
          >
            <FontAwesomeIcon icon={faFillDrip} size="xs" />
          </button>
        </Tooltip>

        <Tooltip
          content={"Text Tool"}
          offsetY={"100% - 12px"}
          offsetX={"50%"}
          className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
        >
          <button
            className={`
              flex p-2 text-text border-b 
              ${textMode ? 'border-text' : 'hover:bg-background2-hover rounded border-transparent'}
            `}
            onClick={() => {
              setErasing(ErasingMode.DISABLED)
              setActiveShape(null)
              setSelectionMode(false)
              setFillMode(false)
              setTextMode(true)
              setMarqueeMode(false)
              setSelectedStrokeIds([])
            }}
          >
            <FontAwesomeIcon icon={faFont} size="xs" />
          </button>
        </Tooltip>



        {/* Eraser with options */}
        <button
          className={`relative drawingOptionMenu`}
          onClick={() => {
            // if (lastErasingMode) {
            //   setErasing(lastErasingMode);
            //   setActiveShape(null);
            //   setSelectionMode(false);
            //   setFillMode(false);
            //   setMarqueeMode(false);
            //   setSelectedStrokeIds([]);
            //   setTextMode(false);
            // }
            setErasingOptionMenu(prev => !prev)
          }}
        >
          <Tooltip
            content={"Select erase mode"}
            offsetY={"100% - 12px"}
            offsetX={"50%"}
            className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
            condition={!erasingOptionMenu}
          >
            <div 
              className={`
                flex p-2 text-text border-b 
                ${erasing ? 'border-text' : 'hover:bg-background2-hover rounded border-transparent'}
              `}>
              <FontAwesomeIcon icon={lastErasingMode == ErasingMode.FULL ? faEraser : faAlignCenter} size="xs" />
            </div>
          </Tooltip>
          <div
            onClick={(e) => e.stopPropagation()}
            className={`
              absolute bg-background2 border border-border2 rounded-lg p-2 top-0 left-0 translate-y-full -translate-x-1/4 flex gap-2 transition-all duration-150
              ${erasingOptionMenu ? 'opacity-100 scale-100' : 'scale-90 opacity-0'}
            `}
          >
            <Tooltip
              content={"Erase complete drawing"}
              offsetY={"100% - 12px"}
              offsetX={"50%"}
              className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
            >
              <div
                className={`
                  relative flex p-2 text-text border-b
                  ${lastErasingMode == ErasingMode.FULL ? 'border-text' : 'border-transparent hover:bg-background2-hover rounded'}
                `}
                onClick={() => {
                  setErasing(ErasingMode.FULL)
                  setActiveShape(null)
                  setSelectionMode(false);
                  setFillMode(false);
                  setMarqueeMode(false);
                  setSelectedStrokeIds([])
                  setTextMode(false)
                }}
              ><FontAwesomeIcon icon={faEraser} size="xs" /></div>
            </Tooltip>
            <Tooltip
              content={"Erase partial drawing"}
              offsetY={"100% - 12px"}
              offsetX={"50%"}
              className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
            >
              <div
                className={`
                  relative flex p-2 text-text border-b
                  ${lastErasingMode == ErasingMode.PARTIAL ? 'border-text' : 'border-transparent hover:bg-background2-hover rounded'}
                `}
                onClick={() => {
                  setErasing(ErasingMode.PARTIAL)
                  setActiveShape(null)
                  setSelectionMode(false);
                  setFillMode(false);
                  setMarqueeMode(false);
                  setSelectedStrokeIds([])
                  setTextMode(false)
                }}
              ><FontAwesomeIcon icon={faAlignCenter} size="xs" /></div>
            </Tooltip>
          </div>
        </button>

      </div>

      <div className="flex gap-2 p-2 bg-background2 border border-border2 rounded-lg">
        {/* Shapes */}
        <Tooltip
          content={"Draw Arrow"}
          offsetY={"100% - 12px"}
          offsetX={"50%"}
          className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
        >
          <button
            className={`
              flex p-2 text-text border-b 
              ${activeShape == 'arrow' ? 'border-text' : 'hover:bg-background2-hover rounded border-transparent'}
            `}
            onClick={() => {
              setErasing(ErasingMode.DISABLED)
              setActiveShape('arrow')
              setSelectionMode(false);
              setFillMode(false);
              setTextMode(false);
              setMarqueeMode(false);
              setSelectedStrokeIds([])
            }}
          >
            <FontAwesomeIcon icon={faArrowRight} size="xs" />
          </button>
        </Tooltip>

        {/* Draw Line */}
        <Tooltip
          content={"Draw Line"}
          offsetY={"100% - 12px"}
          offsetX={"50%"}
          className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
        >
          <button
            // className={`flex p-2 rounded transition-colors ${activeShape === 'line' ? 'bg-primary text-white' : 'hover:bg-primary-hover text-text-secondary border-transparent'}`}
            className={`
              flex p-2 text-text border-b 
              ${activeShape == 'line' ? 'xborder-text' : 'hover:bg-background2-hover rounded border-transparent'}
            `}
            onClick={() => {
              setErasing(ErasingMode.DISABLED)
              setActiveShape('line')
              setSelectionMode(false);
              setFillMode(false);
              setTextMode(false);
              setMarqueeMode(false);
              setSelectedStrokeIds([])
            }}
          >
            <FontAwesomeIcon icon={faSlash} size="xs" />
          </button>
        </Tooltip>

        {/* Draw Square */}
        <Tooltip
          content={"Draw Square"}
          offsetY={"100% - 12px"}
          offsetX={"50%"}
          className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
        >
          <button
            // className={`flex p-2 rounded transition-colors ${activeShape === 'square' ? 'bg-primary text-white' : 'hover:bg-primary-hover text-text-secondary border-transparent'}`}
            className={`
              flex p-2 text-text border-b 
              ${activeShape == 'square' ? 'border-text' : 'hover:bg-background2-hover rounded border-transparent'}
            `}
            onClick={() => {
              setErasing(ErasingMode.DISABLED)
              setActiveShape('square')
              setSelectionMode(false);
              setFillMode(false);
              setTextMode(false);
              setMarqueeMode(false);
              setSelectedStrokeIds([])
            }}
          >
            <FontAwesomeIcon icon={faSquare} size="xs" />
          </button>
        </Tooltip>

        {/* Draw Circle */}
        <Tooltip
          content={"Draw Circle"}
          offsetY={"100% - 12px"}
          offsetX={"50%"}
          className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
        >
          <button
            // className={`flex p-2 rounded transition-colors ${activeShape === 'circle' ? 'bg-primary text-white' : 'hover:bg-primary-hover text-text-secondary border-transparent'}`}
            className={`
              flex p-2 text-text border-b 
              ${activeShape == 'circle' ? 'border-text' : 'hover:bg-background2-hover rounded border-transparent'}
            `}
            onClick={() => {
              setErasing(ErasingMode.DISABLED)
              setActiveShape('circle')
              setSelectionMode(false);
              setFillMode(false);
              setTextMode(false);
              setMarqueeMode(false);
              setSelectedStrokeIds([])
            }}
          >
            <FontAwesomeIcon icon={faCircle} size="xs" />
          </button>
        </Tooltip>

        {/* Draw Diamond */}
        <Tooltip
          content={"Draw Diamond"}
          offsetY={"100% - 12px"}
          offsetX={"50%"}
          className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
        >
          <button
            // className={`flex p-2 rounded transition-colors ${activeShape === 'diamond' ? 'bg-primary text-white' : 'hover:bg-primary-hover text-text-secondary'}`}
            className={`
              flex p-2 text-text border-b 
              ${activeShape == 'diamond' ? 'border-text' : 'hover:bg-background2-hover rounded border-transparent'}
            `}
            onClick={() => {
              setErasing(ErasingMode.DISABLED)
              setActiveShape('diamond')
              setSelectionMode(false);
              setFillMode(false);
              setTextMode(false);
              setMarqueeMode(false);
              setSelectedStrokeIds([])
            }}
          >
            <FontAwesomeIcon icon={faDiamond} size="xs" />
          </button>
        </Tooltip>

      </div>

      <div className="flex gap-2 p-2 bg-background2 border border-border2 rounded-lg">

        {/* Toggle Measurements */}
        <Tooltip
          content={"Toggle Measurements"}
          offsetY={"100% - 12px"}
          offsetX={"50%"}
          className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
        >
          <button
            // className={`flex p-2 rounded transition-colors ${showMeasurements ? 'bg-primary text-white' : 'hover:bg-primary-hover text-text-secondary'}`}
            className={`
              flex p-2 text-text border-b 
              ${showMeasurements ? 'border-text' : 'hover:bg-background2-hover rounded border-transparent'}
            `}
            onClick={() => setShowMeasurements(!showMeasurements)}
          >
            <FontAwesomeIcon icon={faRulerCombined} size="xs" />
          </button>
        </Tooltip>

        {/* Export Menu */}
        <div className="relative drawingOptionMenu">
          <Tooltip
            content={"Export"}
            offsetY={"100% - 12px"}
            offsetX={"50%"}
            className={`bg-background2 p-2 text-nowrap border border-border2 rounded`}
            condition={!exportMenuOpen} // Hide tooltip when menu is open
          >
            <button
              // className={`flex p-2 rounded transition-colors ${exportMenuOpen ? 'bg-primary text-white' : 'hover:bg-primary-hover text-text-secondary'}`}
            className={`
              flex p-2 text-text border-b hover:bg-background2-hover rounded border-transparent
            `}
              onClick={() => {
                setExportMenuOpen(prev => !prev);
                // Close other menus if needed
                setErasingOptionMenu(false);
              }}
            >
              <FontAwesomeIcon icon={faDownload} size="xs" />
            </button>
          </Tooltip>

          {exportMenuOpen && (
            <div className="absolute top-full right-0 pt-4 w-32 z-50">
              <div className="bg-background2 border border-border2 rounded-lg shadow-xl p-1">
                <button
                  className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-background2-hover rounded"
                  onClick={() => {
                    import('src/sandbox/_functions/drawing/exportUtils').then(mod => {
                      const box = marqueeBox || undefined;
                      // If marquee box exists, CLIP strokes to the box.
                      // Otherwise respect selection.
                      const strokesToExport = box
                        ? clipStrokesToRect(strokes, box)
                        : (selectedStrokeIds.length > 0 ? strokes.filter(s => selectedStrokeIds.includes(s.id)) : strokes);

                      mod.downloadSvg(strokesToExport, box);
                      setExportMenuOpen(false);
                    })
                  }}
                >
                  Export SVG
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-background2-hover rounded"
                  onClick={() => {
                    import('src/sandbox/_functions/drawing/exportUtils').then(mod => {
                      const box = marqueeBox || undefined;
                      const strokesToExport = box
                        ? clipStrokesToRect(strokes, box)
                        : (selectedStrokeIds.length > 0 ? strokes.filter(s => selectedStrokeIds.includes(s.id)) : strokes);

                      mod.downloadPng(strokesToExport, box);
                      setExportMenuOpen(false);
                    })
                  }}
                >
                  Export PNG
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
