const res = await fetch("http://localhost:5055/data/metadata.json");
console.log("status:", res.status);
const body = await res.json();
console.log("props:", JSON.stringify(body.props, null, 2));
