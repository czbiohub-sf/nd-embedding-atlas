import type { DataTree, Dataset } from "./types.ts";

/**
 * Hierarchical dataset tree (like xarray DataTree).
 *
 * Implements:
 * - Symbol.asyncDispose → `await using tree = await open("./data.zarr")`
 * - Symbol.iterator → iterate children, supports .map/.filter/.take
 */
export class SimpleDataTree implements DataTree {
    readonly name: string;
    readonly dataset: Dataset | undefined;
    readonly attrs: Record<string, unknown>;
    readonly parent: DataTree | undefined;
    private _children: Map<string, DataTree>;

    constructor(
        name: string,
        opts?: {
            dataset?: Dataset;
            children?: Map<string, DataTree>;
            attrs?: Record<string, unknown>;
            parent?: DataTree;
        },
    ) {
        this.name = name;
        this.dataset = opts?.dataset;
        this._children = opts?.children ?? new Map();
        this.attrs = opts?.attrs ?? {};
        this.parent = opts?.parent;
    }

    get children(): ReadonlyMap<string, DataTree> {
        return this._children;
    }

    addChild(child: DataTree): void {
        this._children.set(child.name, child);
    }

    get(path: string): DataTree | undefined {
        const parts = path.split("/").filter(Boolean);
        let current: DataTree | undefined = this as DataTree;
        for (const part of parts) {
            current = current?.children.get(part);
            if (!current) return undefined;
        }
        return current;
    }

    paths(): string[] {
        const result: string[] = [];
        this._walk((node, prefix) => {
            result.push(prefix ? `${prefix}/${node.name}` : node.name);
        });
        return result;
    }

    datasets(): Map<string, Dataset> {
        const result = new Map<string, Dataset>();
        this._walk((node, prefix) => {
            const p = prefix ? `${prefix}/${node.name}` : node.name;
            if (node.dataset) result.set(p, node.dataset);
        });
        return result;
    }

    /** Iterate direct children. Supports iterator helpers (.map, .filter, .take). */
    [Symbol.iterator](): IterableIterator<DataTree> {
        return this._children.values();
    }

    /**
     * Dispose all resources in the tree recursively.
     * Usage: `await using tree = await axial.open("./data.zarr");`
     */
    async [Symbol.asyncDispose](): Promise<void> {
        // Dispose own dataset
        if (this.dataset) {
            await this.dataset[Symbol.asyncDispose]();
        }
        // Dispose all children recursively
        for (const child of this._children.values()) {
            await child[Symbol.asyncDispose]();
        }
    }

    private _walk(fn: (node: DataTree, prefix: string) => void, prefix = ""): void {
        const p = prefix ? `${prefix}/${this.name}` : this.name;
        fn(this, prefix);
        for (const child of this._children.values()) {
            if (child instanceof SimpleDataTree) {
                child._walk(fn, p);
            }
        }
    }
}
