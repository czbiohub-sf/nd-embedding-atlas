/** The Settings flyout: harness edit mode, theme, table provenance badges, the MCP endpoint. */

import { setProvenanceBadges, useProvenanceBadges } from "@ndea/components/table";
import { Switch } from "@ndea/ui/components/switch";
import { Segmented } from "@ndea/ui/components/toggle-group";

import { setHarnessMode, useProposals } from "@/core/proposals/harness";
import { useTheme } from "@/ThemeProvider";
import { Heading, McpEndpoint } from "./flyout-rows";

export function SettingsFlyout() {
  const { theme, setTheme } = useTheme();
  const provenanceBadges = useProvenanceBadges();
  const { mode } = useProposals().harness.state;
  return (
    <>
      <Heading>Harness edits</Heading>
      <div className="px-2 py-1">
        <Segmented
          label="Harness edits"
          value={mode}
          options={[
            { value: "propose", label: "Propose" },
            { value: "direct", label: "Apply directly" },
          ]}
          onChange={setHarnessMode}
        />
      </div>
      <Heading>Theme</Heading>
      <div className="px-2 py-1">
        <Segmented
          label="Theme"
          value={theme}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
          onChange={setTheme}
        />
      </div>
      <Heading>Table</Heading>
      <label className="flex items-center gap-2 rounded-md px-2 py-1.5">
        <span className="min-w-0 flex-1">Provenance badges</span>
        <Switch
          aria-label="Provenance badges"
          checked={provenanceBadges}
          onCheckedChange={(on) => setProvenanceBadges(on)}
        />
      </label>
      <Heading>MCP endpoint</Heading>
      <McpEndpoint />
    </>
  );
}
