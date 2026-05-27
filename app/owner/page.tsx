import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OwnerDashboard from "./OwnerDashboard";

export default async function OwnerPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single();

  if (profile?.role !== "owner") redirect("/server");

  const [{ data: categories }, { data: items }, { data: alerts }] =
    await Promise.all([
      supabase.from("categories").select("*").order("display_order"),
      supabase.from("items").select("*").order("name"),
      supabase
        .from("alerts")
        .select("*, items(name, unit), profiles:triggered_by(full_name)")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  return (
    <OwnerDashboard
      profile={profile}
      categories={categories ?? []}
      initialItems={items ?? []}
      initialAlerts={alerts ?? []}
    />
  );
}
