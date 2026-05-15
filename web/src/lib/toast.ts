export const TOAST_EVENT = "sn-sql-api:toast";

export type ToastVariant = "ok" | "error";

type ToastDetail = {
  message: string;
  variant: ToastVariant;
};

export const showToast = (
  message: string,
  variant: ToastVariant = "ok",
): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT, {
      detail: { message, variant },
    }),
  );
};
