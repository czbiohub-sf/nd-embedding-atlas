/** The Links flyout: every link (coordination scope) with its value and member views, each with Unlink. */

import { documentLinks } from "@/core/workspace/links";
import { LinkRow } from "@/core/workspace/LinksPopover";
import { useWorkspaceSelector } from "@/core/workspace/workspace-context";
import { Muted } from "./flyout-rows";

export function LinksFlyout() {
  const document = useWorkspaceSelector((ws) => ws.snapshot());
  const links = documentLinks(document);
  if (links.length === 0) return <Muted>No links. Views that share a link appear here.</Muted>;
  return links.map((link) => <LinkRow key={`${link.type}/${link.scope}`} document={document} link={link} />);
}
