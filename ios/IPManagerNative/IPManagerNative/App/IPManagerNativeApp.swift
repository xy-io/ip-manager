import SwiftUI

@main
struct IPManagerNativeApp: App {
    @StateObject private var viewModel = IPListViewModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(viewModel)
                .task {
                    await viewModel.bootstrap()
                }
        }
    }
}
