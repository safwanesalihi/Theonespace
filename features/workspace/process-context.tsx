"use client";
// The studio's process (lib/process.ts) for every screen: its statuses, their colours and what each one
// does, and its pages. Set once by the studio app from the session; the One Core's by default.
import { createContext, useContext } from "react";
import { oneCoreProcess, type Process } from "@/lib/process";

const ProcessContext = createContext<Process>(oneCoreProcess);
export const ProcessProvider = ProcessContext.Provider;
export const useProcess = () => useContext(ProcessContext);
