import { useToast } from '@/hooks/useToast';
import { useTranslation } from 'next-i18next';
import { isObject, has } from 'lodash';

/**
 * copy text data
 */
export const useCopyData = () => {
  const { toast } = useToast();
  const { t } = useTranslation();
  return {
    copyData: (data: string, title: string = 'Copy Success') => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = data;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        toast({
          title: t(title),
          status: 'success',
          duration: 1000
        });
      } catch (error) {
        console.error(error);
        toast({
          title: t('Copy Failed'),
          status: 'error'
        });
      }
    }
  };
};

/**
 * print memory to Mi of Gi
 */
export const printMemory = (val: number) => {
  return val >= 1024 ? `${val / 1024} Gi` : `${val} Mi`;
};

/**
 * download file
 */
export function downLoadBold(content: BlobPart, type: string, fileName: string) {
  // 创建一个 Blob 对象
  const blob = new Blob([content], { type });

  // 创建一个 URL 对象
  const url = URL.createObjectURL(blob);

  // 创建一个 a 标签
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;

  // 模拟点击 a 标签下载文件
  link.click();
}

export function deepSearch(obj: any): string {
  const object = obj as Record<string, unknown>;
  if (has(object, 'message')) {
    return object.message as string;
  }
  for (const key of Object.keys(object)) {
    if (isObject(object[key])) {
      const message = deepSearch(object[key]);
      if (message) {
        return message;
      }
    }
  }
  return 'Error';
}

export const formatStarNumber = (number: number) => {
  if (number < 1000) {
    return number.toString();
  } else if (number < 10000) {
    const thousands = Math.floor(number / 1000);
    const remainder = number % 1000;
    return `${thousands}.${remainder.toString()[0]}k`;
  } else {
    return (number / 1000).toFixed(1) + 'k';
  }
};

export function compareFirstLanguages(acceptLanguageHeader: string) {
  const indexOfZh = acceptLanguageHeader.indexOf('zh');
  const indexOfEn = acceptLanguageHeader.indexOf('en');
  if (indexOfZh === -1) return 'en';
  if (indexOfEn === -1 || indexOfZh < indexOfEn) return 'zh';
  return 'en';
}
