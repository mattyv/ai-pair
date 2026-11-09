#define _GNU_SOURCE
#include <vulkan/vulkan.h>
#include <dlfcn.h>
#include <elf.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>

/* Translate loader virtual addresses only through a file-backed PT_LOAD segment. */
static const unsigned char *elf_address(const unsigned char *data, size_t size, const Elf64_Ehdr *eh, uint64_t addr, size_t length) {
  const Elf64_Phdr *ph = (const Elf64_Phdr *)(data + eh->e_phoff);
  const unsigned char *found = NULL;
  for (size_t i = 0; i < eh->e_phnum; i++) {
    if (ph[i].p_type != PT_LOAD || addr < ph[i].p_vaddr) continue;
    uint64_t delta = addr - ph[i].p_vaddr;
    if (delta > ph[i].p_filesz || length > ph[i].p_filesz - delta || ph[i].p_offset > size ||
        delta > size - ph[i].p_offset || length > size - ph[i].p_offset - delta) continue;
    if (found) return NULL;
    found = data + ph[i].p_offset + delta;
  }
  return found;
}

static uint32_t gnu_hash(const char *name) {
  uint32_t h = 5381;
  while (*name) h = h * 33 + (unsigned char)*name++;
  return h;
}
static uint32_t sysv_hash(const char *name) {
  uint32_t h = 0;
  while (*name) { h = (h << 4) + (unsigned char)*name++; uint32_t g = h & 0xf0000000U; if (g) h ^= g >> 24; h &= ~g; }
  return h;
}

/* Returns -1 on malformed loader metadata, 1 when the object defines an ICD export. */
static int dynamic_exports(const unsigned char *data, size_t size) {
  if (size < sizeof(Elf64_Ehdr)) return -1;
  const Elf64_Ehdr *eh = (const Elf64_Ehdr *)data;
  if (memcmp(eh->e_ident, ELFMAG, SELFMAG) || eh->e_ident[EI_CLASS] != ELFCLASS64 || eh->e_ident[EI_DATA] != ELFDATA2LSB ||
      eh->e_phentsize != sizeof(Elf64_Phdr) || !eh->e_phnum || eh->e_phnum > 1024 || eh->e_phoff > size ||
      (size - eh->e_phoff) / sizeof(Elf64_Phdr) < eh->e_phnum) return -1;
  const Elf64_Phdr *ph = (const Elf64_Phdr *)(data + eh->e_phoff);
  uint64_t symtab = 0, strtab = 0, strsize = 0, syment = 0, hash = 0, ghash = 0;
  int dynamic_found = 0, terminated = 0;
  for (size_t i = 0; i < eh->e_phnum; i++) {
    if (ph[i].p_type != PT_DYNAMIC) continue;
    if (dynamic_found++ || ph[i].p_offset > size || ph[i].p_filesz > size - ph[i].p_offset || ph[i].p_filesz % sizeof(Elf64_Dyn)) return -1;
    if (elf_address(data, size, eh, ph[i].p_vaddr, ph[i].p_filesz) != data + ph[i].p_offset) return -1;
    const Elf64_Dyn *dyn = (const Elf64_Dyn *)(data + ph[i].p_offset);
    for (size_t j = 0; j < ph[i].p_filesz / sizeof(Elf64_Dyn); j++) {
      if (dyn[j].d_tag == DT_NULL) { terminated = 1; break; }
      uint64_t value = dyn[j].d_un.d_val;
      switch (dyn[j].d_tag) {
        case DT_SYMTAB: if (symtab) return -1; symtab = value; break;
        case DT_STRTAB: if (strtab) return -1; strtab = value; break;
        case DT_STRSZ: if (strsize) return -1; strsize = value; break;
        case DT_SYMENT: if (syment) return -1; syment = value; break;
        case DT_HASH: if (hash) return -1; hash = value; break;
        case DT_GNU_HASH: if (ghash) return -1; ghash = value; break;
      }
    }
  }
  if (dynamic_found != 1 || !terminated || !symtab || !strtab || !strsize || strsize > size || syment != sizeof(Elf64_Sym) || (!hash && !ghash)) return -1;
  const char *strings = (const char *)elf_address(data, size, eh, strtab, (size_t)strsize);
  if (!strings) return -1;
  const char *names[] = {"vk_icdGetInstanceProcAddr", "vk_icdNegotiateLoaderICDInterfaceVersion", "vkGetInstanceProcAddr"};
  size_t total_steps = 0;
  for (size_t n = 0; n < sizeof(names)/sizeof(names[0]); n++) {
    uint32_t index, limit = 0, h;
    uint64_t chain;
    int gnu = ghash != 0;
    if (gnu) {
      const uint32_t *head = (const uint32_t *)elf_address(data, size, eh, ghash, 16);
      if (!head || !head[0] || !head[2] || head[0] > 1000000 || head[2] > 1000000) return -1;
      uint64_t buckets = ghash + 16 + (uint64_t)head[2] * 8;
      if (buckets < ghash) return -1;
      h = gnu_hash(names[n]);
      const uint32_t *bucket = (const uint32_t *)elf_address(data, size, eh, buckets + (uint64_t)(h % head[0])*4, 4);
      if (!bucket) return -1;
      index = *bucket;
      if (!index) continue;
      if (index < head[1] || index > 1000000) return -1;
      chain = buckets + (uint64_t)head[0]*4;
      limit = head[1];
    } else {
      const uint32_t *head = (const uint32_t *)elf_address(data, size, eh, hash, 8);
      if (!head || !head[0] || !head[1] || head[0] > 1000000 || head[1] > 1000000 || (uint64_t)head[0] + head[1] > 1000000) return -1;
      const uint32_t *table = (const uint32_t *)elf_address(data, size, eh, hash + 8, ((size_t)head[0] + head[1]) * 4);
      if (!table) return -1;
      for (size_t k = 0; k < (size_t)head[0] + head[1]; k++) if (table[k] >= head[1]) return -1;
      h = sysv_hash(names[n]);
      const uint32_t *bucket = (const uint32_t *)elf_address(data, size, eh, hash + 8 + (uint64_t)(h % head[0])*4, 4);
      if (!bucket) return -1;
      index = *bucket; limit = head[1]; chain = hash + 8 + (uint64_t)head[0]*4;
    }
    for (size_t steps = 0; index && steps < 1000000; steps++) {
      if (++total_steps > 1000000) return -1;
      if ((!gnu && index >= limit) || (gnu && index < limit) || index > 1000000) return -1;
      const Elf64_Sym *symbol = (const Elf64_Sym *)elf_address(data, size, eh, symtab + (uint64_t)index*sizeof(Elf64_Sym), sizeof(Elf64_Sym));
      const uint32_t *next = (const uint32_t *)elf_address(data, size, eh, chain + (uint64_t)(gnu ? index-limit : index)*4, 4);
      if (!symbol || !next || symbol->st_name >= strsize) return -1;
      if ((!gnu || ((*next | 1U) == (h | 1U))) && symbol->st_shndx != SHN_UNDEF &&
          strlen(names[n]) < strsize - symbol->st_name &&
          !memcmp(strings + symbol->st_name, names[n], strlen(names[n]) + 1)) return 1;
      if (gnu) { if (*next & 1U) break; index++; } else index = *next;
      if (steps == 999999) return -1;
    }
  }
  return 0;
}

static int driver_exports(const char *path, unsigned long long device, unsigned long long inode) {
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return -1;
  struct stat st;
  if (fstat(fd, &st) || !S_ISREG(st.st_mode) || (unsigned long long)st.st_dev != device ||
      (unsigned long long)st.st_ino != inode || st.st_size < (off_t)sizeof(Elf64_Ehdr) || st.st_size > 536870912) { close(fd); return -1; }
  size_t size = (size_t)st.st_size;
  const unsigned char *data = mmap(NULL, size, PROT_READ, MAP_PRIVATE, fd, 0);
  if (data == MAP_FAILED) { close(fd); return -1; }
  int result = dynamic_exports(data, size);
  struct stat after, named;
  if (fstat(fd, &after) || stat(path, &named) || after.st_dev != st.st_dev || after.st_ino != st.st_ino ||
      after.st_size != st.st_size || after.st_mtim.tv_sec != st.st_mtim.tv_sec || after.st_mtim.tv_nsec != st.st_mtim.tv_nsec ||
      after.st_ctim.tv_sec != st.st_ctim.tv_sec || after.st_ctim.tv_nsec != st.st_ctim.tv_nsec ||
      named.st_dev != st.st_dev || named.st_ino != st.st_ino) result = -1;
  munmap((void *)data, size);
  close(fd);
  return result;
}

/* Checks that the instance loaded exactly the trusted Radeon file identity. */
static int mapped_driver(const char *loader, const char *expected, const char *device_text, const char *inode_text) {
  char *end = NULL;
  unsigned long long device = strtoull(device_text, &end, 10);
  if (!device_text[0] || !end || *end) return 0;
  unsigned long long inode = strtoull(inode_text, &end, 10);
  if (!inode_text[0] || !end || *end) return 0;
  struct stat info, loader_info;
  if (stat(expected, &info) || !S_ISREG(info.st_mode) || (unsigned long long)info.st_dev != device ||
      (unsigned long long)info.st_ino != inode || stat(loader, &loader_info) || !S_ISREG(loader_info.st_mode)) return 0;
  FILE *maps = fopen("/proc/self/maps", "r");
  if (!maps) return 0;
  char line[8192]; int found = 0; int valid = 1;
  while (fgets(line, sizeof(line), maps)) {
    unsigned int major_number, minor_number; unsigned long long mapped_inode; char file[4096], perms[5];
    if (!strchr(line, '\n')) { valid = 0; break; }
    if (sscanf(line, "%*s %4s %*s %x:%x %llu %4095[^\n]", perms, &major_number, &minor_number, &mapped_inode, file) != 5) continue;
    if (file[0] != '/' || perms[2] != 'x') continue;
    dev_t mapped_device = makedev(major_number, minor_number);
    if (strcmp(file, loader) == 0 && mapped_device == loader_info.st_dev && mapped_inode == (unsigned long long)loader_info.st_ino) continue;
    int classification = driver_exports(file, (unsigned long long)mapped_device, mapped_inode);
    if (classification < 0) { valid = 0; break; }
    if (classification && (strcmp(file, expected) || mapped_inode != inode || mapped_device != info.st_dev)) { valid = 0; break; }
    if (classification) found = 1;
  }
  fclose(maps);
  return valid && found;
}

int main(int argc, char **argv) {
  if (argc != 5 || argv[1][0] != '/' || argv[2][0] != '/') { puts("{\"result\":\"unavailable\"}"); return 1; }
  void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
  if (!library) { puts("{\"result\":\"unavailable\"}"); return 1; }
  PFN_vkGetInstanceProcAddr get = (PFN_vkGetInstanceProcAddr)dlsym(library, "vkGetInstanceProcAddr");
  if (!get) { puts("{\"result\":\"unavailable\"}"); return 1; }
  PFN_vkEnumerateInstanceVersion get_version = (PFN_vkEnumerateInstanceVersion)get(VK_NULL_HANDLE, "vkEnumerateInstanceVersion");
  uint32_t version = 0;
  /* Necessary, but not sufficient, evidence that layer disabling is supported. */
  if (!get_version || get_version(&version) != VK_SUCCESS || VK_API_VERSION_VARIANT(version) != 0 ||
      version < VK_MAKE_API_VERSION(0, 1, 3, 234)) { puts("{\"result\":\"unavailable\"}"); return 1; }
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
  int ok = info.vendorID == 0x1002 && (info.deviceType == VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU || info.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU) && mapped_driver(argv[1], argv[2], argv[3], argv[4]);
  puts(ok ? "{\"result\":\"physical_amd\"}" : "{\"result\":\"unavailable\"}");
  destroy(instance, NULL);
  dlclose(library);
  return ok ? 0 : 1;
}
