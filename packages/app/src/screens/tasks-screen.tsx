"use client";

import { useState } from "react";
import { Platform } from "react-native";
import { ScrollView } from "@counseliq/ui";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  Input,
  InputField,
  Text,
  useToast,
  Toast,
  ToastTitle,
} from "@counseliq/ui";
import { AuthGuard } from "../components/auth-guard";
import { Screen } from "../components/screen";
import { TaskCheckbox } from "../components/task-checkbox";
import { useAuth } from "../auth";
import { getUserFacingErrorMessage } from "../auth/errors";
import { api } from "../db/api";
import { AnalyticsEvent } from "../analytics/events";
import { trackProductEvent } from "../analytics/track-product-event";

export function TasksScreen() {
  return (
    <AuthGuard>
      <TasksContent />
    </AuthGuard>
  );
}

function TasksContent() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const tasks = useQuery(api.tasks.list, user ? {} : "skip");
  const createTask = useMutation(api.tasks.create);
  const toggleTask = useMutation(api.tasks.toggle);
  const removeTask = useMutation(api.tasks.remove);

  const [title, setTitle] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!user || !title.trim()) return;
    setCreating(true);
    try {
      await createTask({ title: title.trim() });
      trackProductEvent(AnalyticsEvent.TASK_CREATED, "tasks", {
        source: "tasks_screen",
      });
      setTitle("");
      toast.show({
        placement: "top",
        render: ({ id }) => (
          <Toast nativeID={id} action="success">
            <ToastTitle>Task added</ToastTitle>
          </Toast>
        ),
      });
    } catch (err: unknown) {
      toast.show({
        placement: "top",
        render: ({ id }) => (
          <Toast nativeID={id} action="error">
            <ToastTitle>
              {getUserFacingErrorMessage(err, "Failed to add task")}
            </ToastTitle>
          </Toast>
        ),
      });
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (taskId: string) => {
    if (!user) return;
    setPendingId(taskId);
    try {
      await toggleTask({ taskId: taskId as never });
      trackProductEvent(AnalyticsEvent.TASK_TOGGLED, "tasks", {
        source: "tasks_screen",
      });
    } finally {
      setPendingId(null);
    }
  };

  const handleDelete = async (taskId: string, taskTitle: string) => {
    if (!user) return;
    const confirmed =
      Platform.OS === "web"
        ? globalThis.confirm?.(`Delete "${taskTitle}"?`) ?? true
        : true;
    if (!confirmed) return;

    setPendingId(taskId);
    try {
      await removeTask({ taskId: taskId as never });
      toast.show({
        placement: "top",
        render: ({ id }) => (
          <Toast nativeID={id} action="muted">
            <ToastTitle>Task deleted</ToastTitle>
          </Toast>
        ),
      });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row items-center justify-between">
        <Text className="text-lg font-bold text-foreground">Tasks</Text>
        <Button variant="outline" onPress={() => router.back()}>
          <ButtonText>Back</ButtonText>
        </Button>
      </Box>

      <ScrollView className="flex-1 w-full">
        <Box className="mx-auto w-full max-w-[640px] flex-col gap-6 p-6">
        <Text className="text-muted-foreground mb-4">
          A sample Convex feature — add, complete, and delete tasks.
        </Text>

        <Box className="flex-row gap-2 mb-6 items-start">
          <Box className="flex-1">
            <Input className="flex-1">
              <InputField
                placeholder="New task..."
                value={title}
                onChangeText={setTitle}
                onSubmitEditing={handleCreate}
              />
            </Input>
          </Box>
          <Button
            variant="default"
            isDisabled={creating || !title.trim()}
            onPress={handleCreate}
          >
            <ButtonText>{creating ? "Adding..." : "Add"}</ButtonText>
          </Button>
        </Box>

        {tasks === undefined ? (
          <Text className="text-muted-foreground">Loading tasks...</Text>
        ) : tasks.length === 0 ? (
          <Text className="text-muted-foreground">No tasks yet. Add one above.</Text>
        ) : (
          <Box className="gap-3">
            {tasks.map((task) => (
              <Box
                key={task._id}
                className="bg-card border border-border rounded-2xl p-4 flex-row items-center gap-3"
              >
                <TaskCheckbox
                  checked={task.done}
                  onChange={() => handleToggle(task._id)}
                  accessibilityLabel={`Mark ${task.title} as ${task.done ? "incomplete" : "complete"}`}
                />
                <Text
                  className={`flex-1 text-base ${
                    task.done
                      ? "text-muted-foreground line-through"
                      : "text-foreground"
                  }`}
                >
                  {task.title}
                </Text>
                <Button
                  variant="destructive"
                  size="sm"
                  isDisabled={pendingId === task._id}
                  onPress={() => handleDelete(task._id, task.title)}
                >
                  <ButtonText>Delete</ButtonText>
                </Button>
              </Box>
            ))}
          </Box>
        )}
        </Box>
      </ScrollView>
    </Screen>
  );
}
