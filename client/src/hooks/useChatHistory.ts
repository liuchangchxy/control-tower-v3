import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { ChatConversation } from '../../../shared/chat';

export function useChatHistory() {
  return useQuery({ queryKey: ['chat-history'], queryFn: () => api.get<ChatConversation[]>('/chat-history') });
}
export function useSaveChat() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (conversation: ChatConversation) => api.put<ChatConversation>(`/chat-history/${conversation.id}`, conversation), onSuccess: () => qc.invalidateQueries({ queryKey: ['chat-history'] }) });
}
export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.del<boolean>(`/chat-history/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['chat-history'] }) });
}
