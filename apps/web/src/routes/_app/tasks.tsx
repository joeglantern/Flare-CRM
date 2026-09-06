import { createFileRoute } from '@tanstack/react-router';
import { TasksScreen } from '@/features/tasks/TasksScreen';

export const Route = createFileRoute('/_app/tasks')({ component: TasksScreen });
