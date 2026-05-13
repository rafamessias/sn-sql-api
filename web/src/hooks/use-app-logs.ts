import { useEffect, useState } from "preact/hooks";
import {
  getAppLogsSnapshot,
  subscribeAppLogs,
  type AppLogEntry,
} from "../lib/app-logs";

export const useAppLogs = (): AppLogEntry[] => {
  const [list, setList] = useState<AppLogEntry[]>(getAppLogsSnapshot);
  useEffect(
    () =>
      subscribeAppLogs(() => {
        setList(getAppLogsSnapshot());
      }),
    [],
  );
  return list;
};
