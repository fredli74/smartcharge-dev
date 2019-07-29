<template>
  <div>
    <component :is="$route.params.provider" :page="$route.params.page" />
  </div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import providers from "@providers/provider-apps";

const components = providers.reduce(
  (map, obj) => {
    map[obj.name] = obj.vue;
    return map;
  },
  {} as any
);

console.debug(components);
@Component({
  components: components
})
export default class Add extends Vue {}
</script>
