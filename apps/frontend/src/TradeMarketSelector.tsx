import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Market = { market_id: string; slug: string; maxLeverage: number | null; icon?: string };
type MenuPosition = { top: number; left: number; width: number; maxHeight: number };

export function TradeMarketSelector({
  marketLabel,
  marketIcon,
  maxLeverage,
  markets,
  marketId,
  onSelectMarket,
}: {
  marketLabel: string;
  marketIcon?: string;
  maxLeverage: number | null;
  markets: Market[];
  marketId: string;
  onSelectMarket: (marketId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const optionButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const updatePosition = () => {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(186, window.innerWidth - 16);
    const top = rect.bottom + 6;
    setPosition({
      top,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
      maxHeight: Math.max(0, Math.min(434, window.innerHeight - top - 8)),
    });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", onOutsidePress);
    document.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", onOutsidePress);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, markets.findIndex((item) => item.market_id === marketId));
    optionButtons.current[index]?.focus();
  }, [open, marketId]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (markets.length === 0) return;
    const current = optionButtons.current.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1) % markets.length;
    else if (event.key === "ArrowUp") next = (current - 1 + markets.length) % markets.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = markets.length - 1;
    else return;
    event.preventDefault();
    optionButtons.current[next]?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="trade-chart__pair"
        aria-label={`Select market, current market ${marketLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (!open) updatePosition();
          setOpen(!open);
        }}
      >
        <span className="trade-chart__pair-icon">
          {marketIcon ? (
            <img src={marketIcon} alt="" width="38" height="38" />
          ) : (
            <span aria-hidden="true">₿</span>
          )}
          <i aria-hidden="true">T</i>
        </span>
        <span>{marketLabel}</span>
        <span className="trade-chart__pair-leverage" title="Maximum market leverage">
          {maxLeverage === null ? "—" : `${maxLeverage}×`}
        </span>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m3 6 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && position && createPortal(
        <div
          ref={menu}
          id={menuId}
          className="trade-chart__market-menu"
          role="menu"
          aria-label="Markets"
          style={position}
          onKeyDown={onMenuKeyDown}
        >
          {markets.map((item, index) => (
            <button
              key={item.market_id}
              ref={(node) => { optionButtons.current[index] = node; }}
              type="button"
              role="menuitemradio"
              aria-checked={item.market_id === marketId}
              aria-label={`${item.slug.replaceAll("-", "/")}, ${item.maxLeverage === null ? "leverage limit unavailable" : `maximum leverage ${item.maxLeverage}×`}`}
              className="trade-chart__market-option"
              onClick={() => {
                onSelectMarket(item.market_id);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <span className="trade-chart__market-icon" aria-hidden="true">
                {item.icon ? <img src={item.icon} alt="" /> : item.slug.slice(0, 1)}
              </span>
              <span className="trade-chart__market-name">{item.slug.replaceAll("-", "/")}</span>
              <span className="trade-chart__market-limit">
                {item.maxLeverage === null ? "—" : `${item.maxLeverage}×`}
              </span>
              <span className="trade-chart__market-check" aria-hidden="true">✓</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
