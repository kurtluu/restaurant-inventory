import { createClient } from "@/lib/supabase/server";
import ServerView from "./ServerView";

export default async function ServerPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user!.id)
    .single();

  const { data: categories } = await supabase
    .from("categories")
    .select("*")
    .order("display_order");

  const { data: items } = await supabase
    .from("items")
    .select("*")
    .eq("active", true)
    .order("name");

  return (
    <ServerView
      profile={profile}
      categories={categories ?? []}
      initialItems={items ?? []}
    />
  );
}
