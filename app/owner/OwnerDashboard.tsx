"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string };
type Item = {
  id: string;
  name: string;
  category_id: string | null;
  unit: string;
  quantity: number;
  low_stock_threshold: number;
  active: boolean;
};
type Alert = {
  id: string;
  message: string;
  trigger_type: string;
  acknowledged: boolean;
  created_at: string;
  items?: { name: string; unit: string } | null;
  profiles?: { full_name: string | null } | null;
};
type Profile = {
  id: string;
  full_name: string | null;
  role: string;
  phone: string | null;
};

export default function OwnerDashboard({
  profile,
  categories,
  initialItems,
  initialAlerts,
}: {
  profile: Profile;
  categories: Category[];
  initialItems: Item[];
  initialAlerts: Alert[];
}) {
  const supabase = createClient();
  const [tab, setTab] = useState<"inventory" | "alerts" | "settings">(
    "inventory"
  );
  const [items, setItems] = useState<Item[]>(initialItems);
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [filter, setFilter] = useState<"all" | "low" | "ok">("all");

  // realtime
  useEffect(() => {
    const itemsChannel = supabase
      .channel("items-owner")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "items" },
        (payload) => {
          if (payload.eventType === "INSERT")
            setItems((p) => [...p, payload.new as Item]);
          if (payload.eventType === "UPDATE")
            setItems((p) =>
              p.map((i) =>
                i.id === (payload.new as Item).id ? (payload.new as Item) : i
              )
            );
          if (payload.eventType === "DELETE")
            setItems((p) => p.filter((i) => i.id !== (payload.old as Item).id));
        }
      )
      .subscribe();

    const alertsChannel = supabase
      .channel("alerts-owner")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts" },
        async (payload) => {
          // re-fetch with joins because realtime payload doesn't include them
          const { data } = await supabase
            .from("alerts")
            .select(
              "*, items(name, unit), profiles:triggered_by(full_name)"
            )
            .eq("id", (payload.new as Alert).id)
            .single();
          if (data) setAlerts((p) => [data as Alert, ...p]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(itemsChannel);
      supabase.removeChannel(alertsChannel);
    };
  }, [supabase]);

  const stats = useMemo(() => {
    const low = items.filter(
      (i) => i.active && i.quantity <= i.low_stock_threshold
    ).length;
    const out = items.filter((i) => i.active && i.quantity <= 0).length;
    const unack = alerts.filter((a) => !a.acknowledged).length;
    return { total: items.filter((i) => i.active).length, low, out, unack };
  }, [items, alerts]);

  const filteredItems = useMemo(() => {
    return items
      .filter((i) => i.active)
      .filter((i) => {
        if (filter === "low")
          return i.quantity <= i.low_stock_threshold;
        if (filter === "ok") return i.quantity > i.low_stock_threshold;
        return true;
      });
  }, [items, filter]);

  function statusColor(item: Item) {
    if (item.quantity <= 0) return "bg-red-100 text-red-800 border-red-200";
    if (item.quantity <= item.low_stock_threshold)
      return "bg-amber-100 text-amber-800 border-amber-200";
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }

  return (
    <div className="min-h-screen">
      <Header
        title="Owner Dashboard"
        subtitle={profile.full_name ?? "Owner"}
      />

      <main className="max-w-5xl mx-auto px-4 py-4">
        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label="Active items" value={stats.total} />
          <Stat label="Low stock" value={stats.low} accent="amber" />
          <Stat label="Out of stock" value={stats.out} accent="red" />
          <Stat label="New alerts" value={stats.unack} accent="red" />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-200 mb-4">
          {(["inventory", "alerts", "settings"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500"
              }`}
            >
              {t === "inventory"
                ? "Inventory"
                : t === "alerts"
                  ? `Alerts ${stats.unack > 0 ? `(${stats.unack})` : ""}`
                  : "Settings"}
            </button>
          ))}
        </div>

        {tab === "inventory" && (
          <div>
            <div className="flex flex-wrap gap-2 mb-3 items-center justify-between">
              <div className="flex gap-2">
                {(["all", "low", "ok"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-full text-sm border ${
                      filter === f
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white border-slate-300"
                    }`}
                  >
                    {f === "all"
                      ? "All"
                      : f === "low"
                        ? "Low / Out"
                        : "OK"}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowAddItem(true)}
                className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                + Add item
              </button>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 font-medium text-right">
                      Quantity
                    </th>
                    <th className="px-4 py-2 font-medium text-right">
                      Threshold
                    </th>
                    <th className="px-4 py-2 font-medium text-right">
                      Status
                    </th>
                    <th className="px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const cat = categories.find(
                      (c) => c.id === item.category_id
                    );
                    return (
                      <tr
                        key={item.id}
                        className="border-t border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-4 py-3 font-medium">{item.name}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {cat?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {Number(item.quantity)} {item.unit}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500">
                          {Number(item.low_stock_threshold)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`text-xs px-2 py-1 rounded-full border ${statusColor(item)}`}
                          >
                            {item.quantity <= 0
                              ? "Out"
                              : item.quantity <= item.low_stock_threshold
                                ? "Low"
                                : "OK"}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-right">
                          <button
                            onClick={() => setEditingItem(item)}
                            className="text-slate-600 hover:text-slate-900 text-sm"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredItems.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-slate-500"
                      >
                        No items match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "alerts" && (
          <AlertsList
            alerts={alerts}
            onAck={async (id) => {
              await supabase
                .from("alerts")
                .update({ acknowledged: true })
                .eq("id", id);
              setAlerts((p) =>
                p.map((a) => (a.id === id ? { ...a, acknowledged: true } : a))
              );
            }}
          />
        )}

        {tab === "settings" && (
          <SettingsTab profile={profile} categories={categories} />
        )}
      </main>

      {editingItem && (
        <ItemModal
          item={editingItem}
          categories={categories}
          onClose={() => setEditingItem(null)}
          onSaved={() => setEditingItem(null)}
          onDeleted={() => setEditingItem(null)}
        />
      )}

      {showAddItem && (
        <ItemModal
          categories={categories}
          onClose={() => setShowAddItem(false)}
          onSaved={() => setShowAddItem(false)}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "red" | "amber";
}) {
  const tone =
    accent === "red"
      ? "text-red-700"
      : accent === "amber"
        ? "text-amber-700"
        : "text-slate-900";
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function AlertsList({
  alerts,
  onAck,
}: {
  alerts: Alert[];
  onAck: (id: string) => void;
}) {
  if (alerts.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500">
        No alerts yet.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <div
          key={a.id}
          className={`bg-white border rounded-xl p-4 flex items-start justify-between gap-3 ${
            a.acknowledged ? "border-slate-200 opacity-60" : "border-amber-300"
          }`}
        >
          <div>
            <div className="font-medium">{a.message}</div>
            <div className="text-xs text-slate-500 mt-1">
              {new Date(a.created_at).toLocaleString()} ·{" "}
              {a.trigger_type === "manual_flag"
                ? `Flagged by ${a.profiles?.full_name ?? "server"}`
                : "Auto threshold"}{" "}
              · SMS: <span className="font-mono">mock</span>
            </div>
          </div>
          {!a.acknowledged && (
            <button
              onClick={() => onAck(a.id)}
              className="bg-slate-900 text-white text-sm px-3 py-1.5 rounded-lg whitespace-nowrap"
            >
              Acknowledge
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function SettingsTab({
  profile,
  categories,
}: {
  profile: Profile;
  categories: Category[];
}) {
  const supabase = createClient();
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [newCategory, setNewCategory] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function savePhone() {
    setSavingPhone(true);
    const { error } = await supabase
      .from("profiles")
      .update({ phone })
      .eq("id", profile.id);
    setSavingPhone(false);
    setMsg(error ? error.message : "Phone saved.");
    setTimeout(() => setMsg(null), 2000);
  }

  async function addCategory() {
    if (!newCategory.trim()) return;
    const { error } = await supabase
      .from("categories")
      .insert({ name: newCategory.trim() });
    if (error) return setMsg(error.message);
    setNewCategory("");
    setMsg("Category added. Refresh to see it.");
    setTimeout(() => setMsg(null), 2000);
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="font-medium mb-2">Owner phone (for SMS alerts)</div>
        <div className="flex gap-2">
          <input
            type="tel"
            placeholder="+15551234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2"
          />
          <button
            onClick={savePhone}
            disabled={savingPhone}
            className="bg-slate-900 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            Save
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Currently in mock mode — alerts appear in the Alerts tab. Wire up
          Twilio in Phase 2 to send real SMS.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="font-medium mb-2">Categories</div>
        <ul className="text-sm text-slate-700 space-y-1 mb-3">
          {categories.map((c) => (
            <li key={c.id}>• {c.name}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="New category"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2"
          />
          <button
            onClick={addCategory}
            className="bg-slate-900 text-white px-4 py-2 rounded-lg"
          >
            Add
          </button>
        </div>
      </div>

      {msg && (
        <div className="text-sm text-slate-600 bg-slate-100 px-3 py-2 rounded-lg">
          {msg}
        </div>
      )}
    </div>
  );
}

function ItemModal({
  item,
  categories,
  onClose,
  onSaved,
  onDeleted,
}: {
  item?: Item;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(item?.name ?? "");
  const [categoryId, setCategoryId] = useState(
    item?.category_id ?? categories[0]?.id ?? ""
  );
  const [unit, setUnit] = useState(item?.unit ?? "unit");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 0));
  const [threshold, setThreshold] = useState(
    String(item?.low_stock_threshold ?? 5)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      category_id: categoryId || null,
      unit: unit.trim() || "unit",
      quantity: Number(quantity),
      low_stock_threshold: Number(threshold),
    };
    const { error } = item
      ? await supabase.from("items").update(payload).eq("id", item.id)
      : await supabase.from("items").insert(payload);
    setSaving(false);
    if (error) return setError(error.message);
    onSaved();
  }

  async function remove() {
    if (!item || !confirm(`Delete ${item.name}? This can't be undone.`))
      return;
    const { error } = await supabase
      .from("items")
      .update({ active: false })
      .eq("id", item.id);
    if (error) return setError(error.message);
    onDeleted?.();
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-20 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6"
      >
        <div className="font-semibold text-lg mb-4">
          {item ? "Edit item" : "Add item"}
        </div>
        <div className="space-y-3">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            />
          </Field>
          <Field label="Category">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Quantity">
              <input
                type="number"
                step="0.1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
            </Field>
            <Field label="Unit">
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="lb, bottle, case"
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
            </Field>
            <Field label="Threshold">
              <input
                type="number"
                step="0.1"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
            </Field>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg mt-4">
            {error}
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-slate-900 text-white py-2.5 rounded-lg font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {item && (
            <button
              onClick={remove}
              className="px-4 py-2.5 text-red-600 border border-red-200 rounded-lg"
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-slate-600 border border-slate-300 rounded-lg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1">{label}</span>
      {children}
    </label>
  );
}
