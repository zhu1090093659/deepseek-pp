import type { ToolRiskLevel } from '../tool/types';

export const MULTIMODAL_MCP_SERVER_NAME = 'Multimodal Vision';
export const MULTIMODAL_MCP_NATIVE_HOST = 'com.deepseek_pp.multimodal';
export const MULTIMODAL_MCP_PACKAGE_NAME = 'deepseek-pp-multimodal-mcp';

export const MULTIMODAL_TOOL_NAMES = ['vision_status', 'analyze_images', 'analyze_video', 'analyze_images_siliconflow', 'analyze_video_siliconflow'] as const;
export type MultimodalToolName = typeof MULTIMODAL_TOOL_NAMES[number];

export interface MultimodalToolSpec {
  name: MultimodalToolName;
  title: string;
  description: string;
  risk: ToolRiskLevel;
}

export const MULTIMODAL_TOOL_SPECS: readonly MultimodalToolSpec[] = [
  {
    name: 'vision_status',
    title: 'Multimodal Status',
    description: 'Check OpenAI image and Gemini video configuration without uploading media.',
    risk: 'low',
  },
  {
    name: 'analyze_images',
    title: 'Analyze Images',
    description: 'Analyze one or more images through OpenAI image inputs.',
    risk: 'medium',
  },
  {
    name: 'analyze_video',
    title: 'Analyze Video',
    description: 'Analyze a video URL, Gemini File API file, or local video through Gemini.',
    risk: 'medium',
  },
  {
    name: 'analyze_images_siliconflow',
    title: 'Analyze Images (SiliconFlow)',
    description: 'Analyze one or more images through SiliconFlow chat completions API.',
    risk: 'medium',
  },
  {
    name: 'analyze_video_siliconflow',
    title: 'Analyze Video (SiliconFlow)',
    description: 'Analyze a video through SiliconFlow chat completions API.',
    risk: 'medium',
  },
] as const;
