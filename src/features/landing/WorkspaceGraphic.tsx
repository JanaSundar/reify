"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { CodeText } from "./MiniCode";
import { easeOut } from "@/components/motion";

const LOOP = `for (let i = 0; i < 3; i++) {
  console.log(i);
}`;

function DarkWindow({ className, children }: { className: string; children?: React.ReactNode }) {
  return (
    <div
      className={`absolute overflow-hidden rounded-2xl bg-[#14141b] shadow-[0_40px_80px_-30px_rgb(10_8_30/0.6),inset_0_0_0_1px_rgb(255_255_255/0.08)] ${className}`}
    >
      {children}
    </div>
  );
}

function TreeNode({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`rounded-md bg-[#2a2550] px-2 py-1 font-mono text-[10px] text-[#d8d0ff] shadow-[inset_0_0_0_1px_rgb(169_144_255/0.35)] ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * "One workspace" illustration: three dark panes (code, visual, split) stacked in depth,
 * sliding in from the left with a gentle scroll parallax.
 */
export function WorkspaceGraphic() {
  const root = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: root, offset: ["start end", "end start"] });
  const back = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [30, -30]);
  const front = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [-20, 20]);

  return (
    <motion.div
      ref={root}
      initial={{ opacity: 0, x: -60 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: "0px 0px -15% 0px" }}
      transition={easeOut(0.9)}
      className="relative aspect-[6/5] w-full [perspective:1600px]"
      aria-hidden
    >
      <div className="haze absolute inset-0 opacity-80" />
      <div className="absolute inset-0 [transform:rotateY(18deg)_rotateX(6deg)] [transform-style:preserve-3d]">
        {/* Translucent layers behind */}
        <div className="glass-sheet absolute top-[18%] left-0 h-[64%] w-[46%] rounded-2xl opacity-60" />
        <div className="glass-sheet absolute top-[14%] left-[5%] h-[66%] w-[46%] rounded-2xl opacity-80" />

        <motion.div style={{ y: back }} className="absolute inset-0">
          <DarkWindow className="top-[6%] left-[14%] h-[70%] w-[62%]">
            <div className="flex gap-2 p-3 text-[10px] text-white/60">
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-white">Code</span>
              <span className="px-2 py-0.5">Visual</span>
              <span className="px-2 py-0.5">Split</span>
            </div>
            <ol className="px-3 font-mono text-[11px] leading-6 text-white/85">
              {LOOP.split("\n").map((line, index) => (
                <li key={index} className="flex gap-3">
                  <span className="text-white/30">{index + 1}</span>
                  <span className="whitespace-pre">
                    <CodeText text={line} />
                  </span>
                </li>
              ))}
            </ol>
          </DarkWindow>
        </motion.div>

        <motion.div style={{ y: front }} className="absolute inset-0">
          <DarkWindow className="top-[30%] left-[40%] h-[64%] w-[60%]">
            <p className="px-4 pt-3 text-[10px] text-white/80">Execution Tree</p>
            <div className="mt-4 flex flex-col items-center gap-3">
              <TreeNode>for (i &lt; 3)</TreeNode>
              <svg viewBox="0 0 200 20" className="h-4 w-3/4 text-[#8f7df0]" aria-hidden>
                <path
                  d="M100 0 V8 M20 20 V8 H180 V20 M100 8 V20"
                  fill="none"
                  stroke="currentColor"
                />
              </svg>
              <div className="flex w-full justify-around px-2">
                {[0, 1, 2].map((i) => (
                  <TreeNode key={i}>i = {i}</TreeNode>
                ))}
              </div>
              <div className="flex w-full justify-around px-1">
                {[0, 1, 2].map((i) => (
                  <TreeNode key={i} className="bg-[#1f1d38] px-1.5 text-[8.5px]">
                    console.log({i})
                  </TreeNode>
                ))}
              </div>
            </div>
          </DarkWindow>
        </motion.div>
      </div>
    </motion.div>
  );
}
