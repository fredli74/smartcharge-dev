<template>
  <v-flex xs12 class="svga-limit">
    <v-card>
      <v-list-item
        v-for="provider in providers"
        :key="provider.name"
        @click="addProvider(provider.name)"
      >
        <v-list-item-avatar tile>
          <img :src="provider.logo" />
        </v-list-item-avatar>

        <v-list-item-content>
          <v-list-item-title>{{ provider.display }}</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
    </v-card>
  </v-flex>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import providers from "@providers/provider-apps";

@Component({
  components: {}
})
export default class Add extends Vue {
  get providers() {
    return providers.filter(f => f.type === this.$route.params.type);
  }
  addProvider(name: string) {
    this.$router.replace({
      path: `/provider/${name}/new`,
      query: this.$route.query
    });
  }
}
</script>
