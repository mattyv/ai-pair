#include <vulkan/vulkan.h>
#include <stdlib.h>
#include <string.h>

static VkResult VKAPI_CALL create(const VkInstanceCreateInfo *info, const VkAllocationCallbacks *alloc, VkInstance *instance) {
  (void)info; (void)alloc; if (getenv("FAKE_GPU") && strcmp(getenv("FAKE_GPU"), "create_fail") == 0) return VK_ERROR_INITIALIZATION_FAILED; *instance = (VkInstance)1; return VK_SUCCESS;
}
static VkResult VKAPI_CALL enumerate(VkInstance instance, uint32_t *count, VkPhysicalDevice *devices) {
  (void)instance;
  const char *kind = getenv("FAKE_GPU");
  if (kind && strcmp(kind, "enum_fail") == 0) return VK_ERROR_INITIALIZATION_FAILED;
  if (kind && strcmp(kind, "incomplete") == 0 && devices) return VK_INCOMPLETE;
  if (kind && strcmp(kind, "changed") == 0 && devices) { *count = 0; return VK_SUCCESS; }
  if (kind && strcmp(kind, "none") == 0) { *count = 0; return VK_SUCCESS; }
  if (kind && strcmp(kind, "multiple") == 0) { *count = 2; return VK_SUCCESS; }
  *count = 1; if (devices) *devices = (VkPhysicalDevice)1; return VK_SUCCESS;
}
static void VKAPI_CALL properties(VkPhysicalDevice device, VkPhysicalDeviceProperties *info) {
  (void)device; memset(info, 0, sizeof(*info));
  const char *kind = getenv("FAKE_GPU");
  info->vendorID = kind && strcmp(kind, "other") == 0 ? 0x8086 : 0x1002;
  info->deviceType = kind && strcmp(kind, "software") == 0 ? VK_PHYSICAL_DEVICE_TYPE_CPU : kind && strcmp(kind, "virtual") == 0 ? VK_PHYSICAL_DEVICE_TYPE_VIRTUAL_GPU : kind && strcmp(kind, "unknown") == 0 ? VK_PHYSICAL_DEVICE_TYPE_OTHER : kind && strcmp(kind, "discrete") == 0 ? VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU : VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU;
}
static void VKAPI_CALL destroy(VkInstance instance, const VkAllocationCallbacks *alloc) { (void)instance; (void)alloc; }
VKAPI_ATTR PFN_vkVoidFunction VKAPI_CALL vkGetInstanceProcAddr(VkInstance instance, const char *name) {
  (void)instance;
  const char *kind = getenv("FAKE_GPU");
  if (kind && strcmp(kind, "missing_symbol") == 0) return NULL;
  if (strcmp(name, "vkCreateInstance") == 0) return (PFN_vkVoidFunction)create;
  if (strcmp(name, "vkEnumeratePhysicalDevices") == 0) return (PFN_vkVoidFunction)enumerate;
  if (strcmp(name, "vkGetPhysicalDeviceProperties") == 0) return (PFN_vkVoidFunction)properties;
  if (strcmp(name, "vkDestroyInstance") == 0) return (PFN_vkVoidFunction)destroy;
  return NULL;
}
