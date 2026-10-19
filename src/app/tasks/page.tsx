"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { supabase as supabaseClient } from "@/lib/supabase";

type TaskStatus = "todo" | "in_progress" | "done";
type Priority = "low" | "medium" | "high";

interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: Priority;
  assigned_to?: string;
  due_date?: string;
  created_at: string;
  clinic_id: string;
}

const supabase = supabaseClient as any;

const COLUMNS: { key: TaskStatus; label: string; emoji: string; color: string }[] = [
  { key: "todo", label: "To Do", emoji: "📋", color: "text-gray-700" },
  { key: "in_progress", label: "In Progress", emoji: "⚡", color: "text-amber-600" },
  { key: "done", label: "Done", emoji: "✅", color: "text-emerald-600" },
];

const PRIORITY_COLORS: Record<Priority, string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-emerald-400",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  high: "High", medium: "Medium", low: "Low",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadTasks(); }, []);

  async function loadTasks() {
    setLoading(true);
    const clinicId = getActiveClinicId();
    if (!clinicId) { setLoading(false); return; }
    const { data } = await supabase
      .from("clinic_tasks")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false });
    setTasks(data ?? []);
    setLoading(false);
  }

  async function saveTask() {
    const clinicId = getActiveClinicId();
    if (!clinicId || !title.trim()) return;
    setSaving(true);
    if (editTask) {
      const { data } = await supabase
        .from("clinic_tasks")
        .update({ title: title.trim(), description, priority, assigned_to: assignedTo || null, due_date: dueDate || null })
        .eq("id", editTask.id)
        .select()
        .single();
      if (data) setTasks((prev) => prev.map((t) => t.id === editTask.id ? data : t));
    } else {
      const { data } = await supabase
        .from("clinic_tasks")
        .insert({ clinic_id: clinicId, title: title.trim(), description, priority, assigned_to: assignedTo || null, due_date: dueDate || null, status: "todo" })
        .select()
        .single();
      if (data) setTasks((prev) => [data, ...prev]);
    }
    resetModal();
    setSaving(false);
  }

  async function moveTask(taskId: string, newStatus: TaskStatus) {
    const { data } = await supabase
      .from("clinic_tasks")
      .update({ status: newStatus })
      .eq("id", taskId)
      .select()
      .single();
    if (data) setTasks((prev) => prev.map((t) => t.id === taskId ? data : t));
  }

  async function deleteTask(taskId: string) {
    await supabase.from("clinic_tasks").delete().eq("id", taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }

  function openEdit(task: Task) {
    setEditTask(task);
    setTitle(task.title);
    setDescription(task.description || "");
    setPriority(task.priority);
    setAssignedTo(task.assigned_to || "");
    setDueDate(task.due_date || "");
    setShowModal(true);
  }

  function resetModal() {
    setShowModal(false);
    setEditTask(null);
    setTitle(""); setDescription(""); setPriority("medium"); setAssignedTo(""); setDueDate("");
  }

  const byStatus = (status: TaskStatus) => tasks.filter((t) => t.status === status);

  return (
    <AppShell>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Task Manager</h1>
            <p className="text-sm text-gray-500 mt-0.5">Assign and track clinical tasks for your team</p>
          </div>
          <button
            onClick={() => { resetModal(); setShowModal(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-violet-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-all shadow-sm"
          >
            <span className="text-lg leading-none">+</span> Add Task
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {COLUMNS.map((col) => (
            <div key={col.key} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
              <span className="text-xl">{col.emoji}</span>
              <div>
                <div className={`text-xs font-semibold ${col.color}`}>{col.label}</div>
                <div className="text-2xl font-bold text-gray-900" style={{ fontFamily: "Sora, Inter, sans-serif" }}>{byStatus(col.key).length}</div>
              </div>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {COLUMNS.map((col) => (
              <div
                key={col.key}
                className="bg-gray-50 rounded-2xl p-4 min-h-[300px]"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) moveTask(dragId, col.key);
                  setDragId(null);
                }}
              >
                {/* Column header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span>{col.emoji}</span>
                    <span className={`text-sm font-bold ${col.color}`}>{col.label}</span>
                  </div>
                  <span className="bg-gray-200 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">{byStatus(col.key).length}</span>
                </div>

                {/* Task cards */}
                <div className="space-y-3">
                  {byStatus(col.key).map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => setDragId(task.id)}
                      onDragEnd={() => setDragId(null)}
                      className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="text-sm font-semibold text-gray-900 leading-snug flex-1">{task.title}</h3>
                        <div className={`w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0 ${PRIORITY_COLORS[task.priority]}`} title={PRIORITY_LABELS[task.priority]} />
                      </div>
                      {task.description && (
                        <p className="text-xs text-gray-500 mb-3 leading-relaxed line-clamp-2">{task.description}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {task.assigned_to && (
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white text-xs font-bold">{task.assigned_to[0]?.toUpperCase()}</div>
                              <span className="text-xs text-gray-500">{task.assigned_to}</span>
                            </div>
                          )}
                          {task.due_date && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${new Date(task.due_date) < new Date() ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-500"}`}>
                              📅 {new Date(task.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* Move buttons */}
                          {col.key !== "todo" && (
                            <button onClick={() => moveTask(task.id, col.key === "done" ? "in_progress" : "todo")} className="p-1 text-gray-400 hover:text-gray-700 text-xs" title="Move back">←</button>
                          )}
                          {col.key !== "done" && (
                            <button onClick={() => moveTask(task.id, col.key === "todo" ? "in_progress" : "done")} className="p-1 text-gray-400 hover:text-gray-700 text-xs" title="Move forward">→</button>
                          )}
                          <button onClick={() => openEdit(task)} className="p-1 text-gray-400 hover:text-blue-600 text-xs">✏️</button>
                          <button onClick={() => { if (confirm("Delete this task?")) deleteTask(task.id); }} className="p-1 text-gray-400 hover:text-red-500 text-xs">🗑</button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {byStatus(col.key).length === 0 && (
                    <div className="text-center py-8 text-gray-400 text-xs">
                      <div className="text-3xl mb-2 opacity-40">{col.emoji}</div>
                      No {col.label.toLowerCase()} tasks
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1" style={{ fontFamily: "Sora, Inter, sans-serif" }}>
              {editTask ? "Edit Task" : "New Task"}
            </h2>
            <p className="text-sm text-gray-500 mb-5">Fill in the details below</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Task Title *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Sterilise OT Room 2"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Optional details…"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="high">🔴 High</option>
                    <option value="medium">🟡 Medium</option>
                    <option value="low">🟢 Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Due Date</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Assign To</label>
                <input type="text" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="e.g. Dr. Sharma, Ward Boy…" className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={resetModal} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition-all">Cancel</button>
              <button onClick={saveTask} disabled={saving || !title.trim()} className="flex-[2] py-2.5 bg-gradient-to-r from-blue-600 to-violet-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all shadow-sm">
                {saving ? "Saving…" : editTask ? "Save changes" : "Create task"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
