"use client";

import { useEffect, useState } from "react";
import type { GraffitiItem } from "@/lib/graffiti";

export function GraffitiWall() {
  const [items, setItems] = useState<GraffitiItem[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const res = await fetch("/api/graffiti", { cache: "no-store" });
      if (!res.ok) {
        return;
      }

      const next = (await res.json()) as GraffitiItem[];
      if (active) {
        setItems(next);
      }
    };

    void load();
    const poll = setInterval(() => {
      void load();
    }, 1500);

    return () => {
      active = false;
      clearInterval(poll);
    };
  }, []);

  return (
    <div className="wall-shell">
      <h1 className="wall-title">Lefty's Bathroom Wall</h1>
      <div className="wall">
        <img className="wall-bg" src="/leftys-bg.png" alt="Lefty's Bathroom wall background" />
        {items.map((item) => {
          if (item.type === "image") {
            return (
              <div
                className="graffiti-item"
                key={item.id}
                style={{
                  left: `${item.position.x}%`,
                  top: `${item.position.y}%`,
                  width: `${item.dimensions.width}%`,
                  height: `${item.dimensions.height}%`,
                  opacity: item.opacity,
                  transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`
                }}
              >
                <img className="graffiti-image" src={item.imageUrl} alt="Graffiti" />
              </div>
            );
          }

          return (
            <div
              className="graffiti-item"
              key={item.id}
              style={{
                left: `${item.position.x}%`,
                top: `${item.position.y}%`,
                opacity: item.opacity,
                transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`
              }}
            >
              <p
                className="graffiti-text"
                style={{
                  fontFamily: item.font,
                  color: item.color,
                  fontSize: `${item.size}px`
                }}
              >
                {item.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
