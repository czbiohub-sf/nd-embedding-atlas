export async function main(): Promise<void> {
  const res = await fetch("http://localhost:5055/data/metadata.json");
  console.log("status:", res.status);
  const body = (await res.json()) as { props?: unknown };
  console.log("props:", JSON.stringify(body.props, null, 2));
}

await main();
