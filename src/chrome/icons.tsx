/** Hugeicons chrome set. Glyphs are deep-imported so the 5MB catalog is not bundled. */
import {
  HugeiconsIcon,
  type HugeiconsIconProps,
  type IconSvgElement,
} from "@hugeicons/react";
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import AddSquareIcon from "@hugeicons/core-free-icons/AddSquareIcon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import AppWindowIcon from "@hugeicons/core-free-icons/AppWindowIcon";
import ArchiveIcon from "@hugeicons/core-free-icons/ArchiveIcon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowExpand01Icon from "@hugeicons/core-free-icons/ArrowExpand01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import BotIcon from "@hugeicons/core-free-icons/BotIcon";
import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CaseSensitiveIcon from "@hugeicons/core-free-icons/CaseSensitiveIcon";
import CircleArrowDown01Icon from "@hugeicons/core-free-icons/CircleArrowDown01Icon";
import CircleDashedIcon from "@hugeicons/core-free-icons/CircleDashedIcon";
import CircleDotIcon from "@hugeicons/core-free-icons/CircleDotIcon";
import CloudUploadIcon from "@hugeicons/core-free-icons/CloudUploadIcon";
import ColorPickerIcon from "@hugeicons/core-free-icons/ColorPickerIcon";
import Comment01Icon from "@hugeicons/core-free-icons/Comment01Icon";
import CommentAdd01Icon from "@hugeicons/core-free-icons/CommentAdd01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import DragDropVerticalIcon from "@hugeicons/core-free-icons/DragDropVerticalIcon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import FileAddIcon from "@hugeicons/core-free-icons/FileAddIcon";
import FilePlusCornerIcon from "@hugeicons/core-free-icons/FilePlusCornerIcon";
import FilterIcon from "@hugeicons/core-free-icons/FilterIcon";
import FlashIcon from "@hugeicons/core-free-icons/FlashIcon";
import FoldVerticalIcon from "@hugeicons/core-free-icons/FoldVerticalIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
import GaugeIcon from "@hugeicons/core-free-icons/GaugeIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import GitCompareIcon from "@hugeicons/core-free-icons/GitCompareIcon";
import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
import ImageAdd01Icon from "@hugeicons/core-free-icons/ImageAdd01Icon";
import InboxIcon from "@hugeicons/core-free-icons/InboxIcon";
import JusticeScale01Icon from "@hugeicons/core-free-icons/JusticeScale01Icon";
import KeyboardIcon from "@hugeicons/core-free-icons/KeyboardIcon";
import LayoutBottomIcon from "@hugeicons/core-free-icons/LayoutBottomIcon";
import LayoutTopIcon from "@hugeicons/core-free-icons/LayoutTopIcon";
import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import MagicWand01Icon from "@hugeicons/core-free-icons/MagicWand01Icon";
import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import Note01Icon from "@hugeicons/core-free-icons/Note01Icon";
import PaintBoardIcon from "@hugeicons/core-free-icons/PaintBoardIcon";
import PencilEdit01Icon from "@hugeicons/core-free-icons/PencilEdit01Icon";
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon";
import PinIcon from "@hugeicons/core-free-icons/PinIcon";
import PinOffIcon from "@hugeicons/core-free-icons/PinOffIcon";
import PreferenceHorizontalIcon from "@hugeicons/core-free-icons/PreferenceHorizontalIcon";
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon";
import RegexIcon from "@hugeicons/core-free-icons/RegexIcon";
import RotateCcwIcon from "@hugeicons/core-free-icons/RotateCcwIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import SidebarLeft01Icon from "@hugeicons/core-free-icons/SidebarLeft01Icon";
import SidebarRight01Icon from "@hugeicons/core-free-icons/SidebarRight01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import SquareIcon from "@hugeicons/core-free-icons/SquareIcon";
import SquareLock02Icon from "@hugeicons/core-free-icons/SquareLock02Icon";
import SquareUnlock01Icon from "@hugeicons/core-free-icons/SquareUnlock01Icon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import UndoIcon from "@hugeicons/core-free-icons/UndoIcon";
import UnfoldVerticalIcon from "@hugeicons/core-free-icons/UnfoldVerticalIcon";
import UngroupItemsIcon from "@hugeicons/core-free-icons/UngroupItemsIcon";
import WholeWordIcon from "@hugeicons/core-free-icons/WholeWordIcon";
import Wrench01Icon from "@hugeicons/core-free-icons/Wrench01Icon";
import { forwardRef, type Ref } from "react";

/** Props shared by every chrome icon. `icon` is filled in by the named wrappers. */
export type IconProps = Omit<HugeiconsIconProps, "icon">;

export type IconComponent = ReturnType<typeof wrap>;

function wrap(icon: IconSvgElement, name: string) {
  const Component = forwardRef(function Icon(
    { strokeWidth = 1.75, ...props }: IconProps,
    ref: Ref<SVGSVGElement>,
  ) {
    return (
      <HugeiconsIcon
        ref={ref}
        icon={icon}
        strokeWidth={strokeWidth}
        {...props}
      />
    );
  });
  Component.displayName = name;
  return Component;
}

export const AlertCircle = wrap(AlertCircleIcon, "AlertCircle");
export const AppWindow = wrap(AppWindowIcon, "AppWindow");
export const Archive = wrap(ArchiveIcon, "Archive");
export const ArrowDownCircle = wrap(CircleArrowDown01Icon, "ArrowDownCircle");
export const ArrowLeft = wrap(ArrowLeft01Icon, "ArrowLeft");
export const ArrowUp = wrap(ArrowUp01Icon, "ArrowUp");
export const Bot = wrap(BotIcon, "Bot");
export const Brain = wrap(BrainIcon, "Brain");
export const CaseSensitive = wrap(CaseSensitiveIcon, "CaseSensitive");
export const Check = wrap(Tick02Icon, "Check");
export const ChevronDown = wrap(ArrowDown01Icon, "ChevronDown");
export const ChevronLeft = wrap(ArrowLeft01Icon, "ChevronLeft");
export const ChevronRight = wrap(ArrowRight01Icon, "ChevronRight");
export const ChevronUp = wrap(ArrowUp01Icon, "ChevronUp");
export const CircleAlert = wrap(AlertCircleIcon, "CircleAlert");
export const CircleDashed = wrap(CircleDashedIcon, "CircleDashed");
export const CircleDot = wrap(CircleDotIcon, "CircleDot");
export const CloudUpload = wrap(CloudUploadIcon, "CloudUpload");
export const Copy = wrap(Copy01Icon, "Copy");
export const ExternalLink = wrap(LinkSquare02Icon, "ExternalLink");
export const File = wrap(File01Icon, "File");
export const FilePlus = wrap(FileAddIcon, "FilePlus");
export const FilePlusCorner = wrap(FilePlusCornerIcon, "FilePlusCorner");
export const FoldVertical = wrap(FoldVerticalIcon, "FoldVertical");
export const Folder = wrap(Folder01Icon, "Folder");
export const FolderOpen = wrap(FolderOpenIcon, "FolderOpen");
export const FolderPlus = wrap(FolderAddIcon, "FolderPlus");
export const Gauge = wrap(GaugeIcon, "Gauge");
export const GitBranch = wrap(GitBranchIcon, "GitBranch");
export const GitCompare = wrap(GitCompareIcon, "GitCompare");
export const GitPullRequest = wrap(GitPullRequestIcon, "GitPullRequest");
export const GripVertical = wrap(DragDropVerticalIcon, "GripVertical");
export const ImagePlus = wrap(ImageAdd01Icon, "ImagePlus");
export const Inbox = wrap(InboxIcon, "Inbox");
export const Keyboard = wrap(KeyboardIcon, "Keyboard");
export const ListFilter = wrap(FilterIcon, "ListFilter");
export const Loader = wrap(Loading03Icon, "Loader");
export const LoaderCircle = wrap(Loading03Icon, "LoaderCircle");
export const Lock = wrap(SquareLock02Icon, "Lock");
export const LockOpen = wrap(SquareUnlock01Icon, "LockOpen");
export const Maximize2 = wrap(ArrowExpand01Icon, "Maximize2");
export const MessageSquare = wrap(Comment01Icon, "MessageSquare");
export const MessageSquarePlus = wrap(CommentAdd01Icon, "MessageSquarePlus");
export const Minus = wrap(MinusSignIcon, "Minus");
export const MoreHorizontal = wrap(MoreHorizontalIcon, "MoreHorizontal");
export const Palette = wrap(PaintBoardIcon, "Palette");
export const PanelBottom = wrap(LayoutBottomIcon, "PanelBottom");
export const PanelLeft = wrap(SidebarLeft01Icon, "PanelLeft");
export const PanelRight = wrap(SidebarRight01Icon, "PanelRight");
export const PanelTop = wrap(LayoutTopIcon, "PanelTop");
export const PenLine = wrap(PencilEdit01Icon, "PenLine");
export const Pencil = wrap(PencilEdit02Icon, "Pencil");
export const Pin = wrap(PinIcon, "Pin");
export const PinOff = wrap(PinOffIcon, "PinOff");
export const Pipette = wrap(ColorPickerIcon, "Pipette");
export const Plus = wrap(Add01Icon, "Plus");
export const RefreshCw = wrap(Refresh01Icon, "RefreshCw");
export const Regex = wrap(RegexIcon, "Regex");
export const RotateCcw = wrap(RotateCcwIcon, "RotateCcw");
export const Scale = wrap(JusticeScale01Icon, "Scale");
export const Search = wrap(Search01Icon, "Search");
export const Settings = wrap(Settings01Icon, "Settings");
export const SlidersHorizontal = wrap(
  PreferenceHorizontalIcon,
  "SlidersHorizontal",
);
export const Sparkles = wrap(SparklesIcon, "Sparkles");
export const Square = wrap(SquareIcon, "Square");
export const SquarePlus = wrap(AddSquareIcon, "SquarePlus");
export const Star = wrap(StarIcon, "Star");
export const StickyNote = wrap(Note01Icon, "StickyNote");
export const Terminal = wrap(TerminalIcon, "Terminal");
export const Trash2 = wrap(Delete02Icon, "Trash2");
export const Undo2 = wrap(UndoIcon, "Undo2");
export const UnfoldVertical = wrap(UnfoldVerticalIcon, "UnfoldVertical");
export const Ungroup = wrap(UngroupItemsIcon, "Ungroup");
export const WandSparkles = wrap(MagicWand01Icon, "WandSparkles");
export const WholeWord = wrap(WholeWordIcon, "WholeWord");
export const Wrench = wrap(Wrench01Icon, "Wrench");
export const X = wrap(Cancel01Icon, "X");
export const Zap = wrap(FlashIcon, "Zap");
