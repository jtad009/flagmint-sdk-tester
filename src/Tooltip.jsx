import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Lightweight port of Flagmint's Tooltip (portal + hover).
 * Inline styles so the SDK tester does not need Tailwind.
 */
export function Tooltip({
  content,
  children,
  position = 'top',
  className,
  multiline = false,
  maxWidth = 260,
  /** Stretch to parent width (QA grid, flex:1 buttons). */
  fill = false,
  style,
}) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef(null);
  const tipRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!visible) {
      setCoords(null);
      return;
    }

    const GAP = 8;
    const PAD = 8;
    const ARROW_INSET = 12;

    const update = () => {
      const trigger = triggerRef.current;
      const tip = tipRef.current;
      if (!trigger || !tip) return;

      const tr = trigger.getBoundingClientRect();
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      const cx = tr.left + tr.width / 2;
      const cy = tr.top + tr.height / 2;

      let top = 0;
      let left = 0;
      switch (position) {
        case 'bottom':
          top = tr.bottom + GAP;
          left = cx - tw / 2;
          break;
        case 'left':
          top = cy - th / 2;
          left = tr.left - tw - GAP;
          break;
        case 'right':
          top = cy - th / 2;
          left = tr.right + GAP;
          break;
        case 'top':
        default:
          top = tr.top - th - GAP;
          left = cx - tw / 2;
          break;
      }

      left = Math.min(Math.max(left, PAD), Math.max(PAD, window.innerWidth - tw - PAD));
      top = Math.min(Math.max(top, PAD), Math.max(PAD, window.innerHeight - th - PAD));

      const alongX = position === 'top' || position === 'bottom';
      const rawArrow = alongX ? cx - left : cy - top;
      const maxArrow = alongX ? tw - ARROW_INSET : th - ARROW_INSET;
      const arrow = Math.min(Math.max(rawArrow, ARROW_INSET), Math.max(ARROW_INSET, maxArrow));

      setCoords({ top, left, arrow });
    };

    update();
    const observer = new ResizeObserver(update);
    if (tipRef.current) observer.observe(tipRef.current);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [visible, position, content, multiline, maxWidth]);

  const alongX = position === 'top' || position === 'bottom';

  const arrowStyle = (() => {
    const base = {
      position: 'absolute',
      width: 0,
      height: 0,
      borderStyle: 'solid',
      borderWidth: 4,
    };
    if (!coords) return base;
    if (position === 'top') {
      return {
        ...base,
        top: '100%',
        left: coords.arrow,
        transform: 'translateX(-50%)',
        borderColor: '#111827 transparent transparent transparent',
      };
    }
    if (position === 'bottom') {
      return {
        ...base,
        bottom: '100%',
        left: coords.arrow,
        transform: 'translateX(-50%)',
        borderColor: 'transparent transparent #111827 transparent',
      };
    }
    if (position === 'left') {
      return {
        ...base,
        left: '100%',
        top: coords.arrow,
        transform: 'translateY(-50%)',
        borderColor: 'transparent transparent transparent #111827',
      };
    }
    return {
      ...base,
      right: '100%',
      top: coords.arrow,
      transform: 'translateY(-50%)',
      borderColor: 'transparent #111827 transparent transparent',
    };
  })();

  const tip = (
    <div
      ref={tipRef}
      style={{
        position: 'fixed',
        zIndex: 9999,
        pointerEvents: 'none',
        top: coords ? coords.top : 0,
        left: coords ? coords.left : 0,
        opacity: visible && coords ? 1 : 0,
        visibility: visible ? 'visible' : 'hidden',
        transition: coords ? 'opacity 160ms, visibility 160ms' : 'none',
        background: '#111827',
        color: '#F9FAFB',
        borderRadius: 8,
        boxShadow: '0 10px 25px rgba(0,0,0,0.45)',
        padding: multiline ? '10px 12px' : '6px 8px',
        fontSize: 11,
        lineHeight: 1.45,
        maxWidth,
        whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
      }}
    >
      {content}
      <div style={arrowStyle} />
    </div>
  );

  return (
    <>
      <div
        ref={triggerRef}
        className={className}
        style={{
          display: fill ? 'block' : 'inline-block',
          width: fill ? '100%' : undefined,
          ...style,
        }}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >
        {children}
      </div>
      {mounted && createPortal(tip, document.body)}
    </>
  );
}
