#include <vulkan/vulkan.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdint.h>

int main(int argc, char **argv) {
  if (argc != 2 || argv[1][0] != '/') { puts("{\"result\":\"unavailable\"}"); return 1; }
  void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
  if (!library) { puts("{\"result\":\"unavailable\"}"); return 1; }
  PFN_vkGetInstanceProcAddr get = (PFN_vkGetInstanceProcAddr)dlsym(library, "vkGetInstanceProcAddr");
  if (!get) { puts("{\"result\":\"unavailable\"}"); return 1; }
  PFN_vkCreateInstance create = (PFN_vkCreateInstance)get(VK_NULL_HANDLE, "vkCreateInstance");
  if (!create) { puts("{\"result\":\"unavailable\"}"); return 1; }
  VkApplicationInfo app = {.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO, .apiVersion = VK_API_VERSION_1_0};
  VkInstanceCreateInfo config = {.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, .pApplicationInfo = &app};
  VkInstance instance;
  if (create(&config, NULL, &instance) != VK_SUCCESS) { puts("{\"result\":\"unavailable\"}"); return 1; }
  PFN_vkEnumeratePhysicalDevices enumerate = (PFN_vkEnumeratePhysicalDevices)get(instance, "vkEnumeratePhysicalDevices");
  PFN_vkGetPhysicalDeviceProperties properties = (PFN_vkGetPhysicalDeviceProperties)get(instance, "vkGetPhysicalDeviceProperties");
  PFN_vkDestroyInstance destroy = (PFN_vkDestroyInstance)get(instance, "vkDestroyInstance");
  uint32_t count = 0;
  if (!enumerate || !properties || !destroy || enumerate(instance, &count, NULL) != VK_SUCCESS || count != 1) {
    puts("{\"result\":\"unavailable\"}"); if (destroy) destroy(instance, NULL); return 1;
  }
  VkPhysicalDevice device;
  if (enumerate(instance, &count, &device) != VK_SUCCESS || count != 1) { puts("{\"result\":\"unavailable\"}"); destroy(instance, NULL); return 1; }
  VkPhysicalDeviceProperties info;
  properties(device, &info);
  int ok = info.vendorID == 0x1002 && (info.deviceType == VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU || info.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU);
  puts(ok ? "{\"result\":\"physical_amd\"}" : "{\"result\":\"unavailable\"}");
  destroy(instance, NULL);
  dlclose(library);
  return ok ? 0 : 1;
}
