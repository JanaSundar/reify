import type { Metadata } from "next";
import { PlaygroundLoader } from "./PlaygroundLoader";

export const metadata: Metadata = {
  title: "Playground",
  description:
    "Write JavaScript or TypeScript, run it, and step forward and backward through its execution: variables, arrays, objects, call stack and recursion.",
  alternates: { canonical: "/playground" },
};

export default function PlaygroundPage() {
  return (
    <>
      <h1 className="sr-only">Code execution playground</h1>
      <PlaygroundLoader />
    </>
  );
}
