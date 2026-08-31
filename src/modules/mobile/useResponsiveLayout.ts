import { useEffect, useState } from "react";
import { IS_MOBILE_OS } from "@/lib/platform";

export interface ResponsiveLayout {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouch: boolean;
  isPortrait: boolean;
  isLandscape: boolean;
  width: number;
  height: number;
}

function getLayoutState(): ResponsiveLayout {
  if (typeof window === "undefined") {
    return {
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isTouch: false,
      isPortrait: false,
      isLandscape: true,
      width: 1920,
      height: 1080,
    };
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const isPortrait = height >= width;
  const isLandscape = width > height;

  const isMobile = IS_MOBILE_OS && width < 768;
  const isTablet = IS_MOBILE_OS && width >= 768;
  const isDesktop = !IS_MOBILE_OS;
  const isTouch = IS_MOBILE_OS;

  return {
    isMobile,
    isTablet,
    isDesktop,
    isTouch,
    isPortrait,
    isLandscape,
    width,
    height,
  };
}

export function useResponsiveLayout(): ResponsiveLayout {
  const [layout, setLayout] = useState<ResponsiveLayout>(getLayoutState);

  useEffect(() => {
    const onResize = () => setLayout(getLayoutState());
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return layout;
}
