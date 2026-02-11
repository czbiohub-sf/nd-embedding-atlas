import { DashboardProvider, DashboardShell } from "./dashboard";

export default function App() {
    return (
        <DashboardProvider>
            <DashboardShell />
        </DashboardProvider>
    );
}
