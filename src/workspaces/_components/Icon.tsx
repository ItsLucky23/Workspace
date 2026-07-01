//? Workspaces — thin FontAwesome wrapper.
//?
//? The design (and the prototype) reference icons by their FontAwesome kebab
//? name (`<i class="fa-solid fa-robot">`). Our codebase uses the React
//? component + imported icon objects. This map keeps the call-sites clean
//? (`<Icon name="robot" />`) while staying on our real FontAwesome setup.
//? Add a name here the first time a screen needs it.

import {
  FontAwesomeIcon,
  faAngleLeft, faAngleRight, faAngleDown, faArrowLeft, faBan, faBars, faBell, faBolt, faBookOpen, faBoxArchive,
  faCalendarDay, faCaretDown, faChartColumn, faCheck, faCircleCheck, faCircleQuestion,
  faClock, faCodeBranch, faCodeMerge, faComment, faCopy, faDatabase, faDiagramProject, faDisplay, faEllipsis,
  faEye, faFileLines, faFilter, faGear, faGripVertical, faLanguage, faLink, faListCheck,
  faMagnifyingGlass, faMobileScreen, faMoon, faPaperPlane, faPause, faPlay, faPlus, faRightFromBracket,
  faRobot, faShieldHalved, faSliders, faSun, faTableCellsLarge, faTableColumns, faTerminal, faTrash, faTriangleExclamation,
  faUpRightFromSquare, faUser, faUsers, faWandMagicSparkles, faWaveSquare, faXmark,
} from 'src/_functions/icon';

type FaIcon = typeof faRobot;

const ICONS: Record<string, FaIcon> = {
  'angle-left': faAngleLeft,
  'angle-right': faAngleRight,
  'angle-down': faAngleDown,
  'arrow-left': faArrowLeft,
  ban: faBan,
  bars: faBars,
  bell: faBell,
  bolt: faBolt,
  'book-open': faBookOpen,
  'box-archive': faBoxArchive,
  'calendar-day': faCalendarDay,
  'caret-down': faCaretDown,
  'chart-column': faChartColumn,
  check: faCheck,
  'circle-check': faCircleCheck,
  'circle-question': faCircleQuestion,
  clock: faClock,
  'code-branch': faCodeBranch,
  'code-merge': faCodeMerge,
  comment: faComment,
  copy: faCopy,
  database: faDatabase,
  'diagram-project': faDiagramProject,
  display: faDisplay,
  ellipsis: faEllipsis,
  eye: faEye,
  'file-lines': faFileLines,
  filter: faFilter,
  gear: faGear,
  'grip-vertical': faGripVertical,
  language: faLanguage,
  link: faLink,
  'list-check': faListCheck,
  'magnifying-glass': faMagnifyingGlass,
  'mobile-screen': faMobileScreen,
  moon: faMoon,
  'paper-plane': faPaperPlane,
  pause: faPause,
  play: faPlay,
  plus: faPlus,
  'right-from-bracket': faRightFromBracket,
  robot: faRobot,
  'shield-halved': faShieldHalved,
  sliders: faSliders,
  sun: faSun,
  'table-cells-large': faTableCellsLarge,
  'table-columns': faTableColumns,
  terminal: faTerminal,
  trash: faTrash,
  'triangle-exclamation': faTriangleExclamation,
  'up-right-from-square': faUpRightFromSquare,
  user: faUser,
  users: faUsers,
  'wand-magic-sparkles': faWandMagicSparkles,
  'wave-square': faWaveSquare,
  xmark: faXmark,
};

export type IconName = keyof typeof ICONS | (string & {});

interface IconProps {
  name: IconName;
  className?: string;
}

export default function Icon({ name, className }: IconProps) {
  const def = ICONS[name] ?? faCircleQuestion;
  return <FontAwesomeIcon icon={def} className={className} />;
}
