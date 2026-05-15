export type TableApiFormState = {
  table: string;
  sysparm_query: string;
  sysparm_fields: string;
  sysparm_limit: string;
  sysparm_offset: string;
  sysparm_view: string;
  sysparm_display_value: "" | "true" | "false" | "all";
  sysparm_exclude_reference_link: boolean;
};

export const defaultTableApiForm = (): TableApiFormState => ({
  table: "",
  sysparm_query: "",
  sysparm_fields: "",
  sysparm_limit: "100",
  sysparm_offset: "",
  sysparm_view: "",
  sysparm_display_value: "",
  sysparm_exclude_reference_link: false,
});
